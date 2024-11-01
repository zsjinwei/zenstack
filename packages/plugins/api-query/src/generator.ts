import {
    PluginOptions,
    createProject,
    ensureEmptyDir,
    generateModelMeta,
    getDataModels,
    isDelegateModel,
    requireOption,
    resolvePath,
    saveProject,
} from '@zenstackhq/sdk';
import { DataModel, DataModelFieldType, Model, isEnum } from '@zenstackhq/sdk/ast';
import { getPrismaClientImportSpec, supportCreateMany, type DMMF } from '@zenstackhq/sdk/prisma';
import { paramCase } from 'change-case';
import { lowerCaseFirst } from 'lower-case-first';
import path from 'path';
import { Project, SourceFile } from 'ts-morph';
import { P, match } from 'ts-pattern';
import { upperCaseFirst } from 'upper-case-first';
import { name } from '.';

export async function generate(model: Model, options: PluginOptions, dmmf: DMMF.Document) {
    const project = createProject();
    const warnings: string[] = [];
    const models = getDataModels(model);

    let outDir = requireOption<string>(options, 'output', name);
    outDir = resolvePath(outDir, options);
    ensureEmptyDir(outDir);

    await generateModelMeta(project, models, {
        output: path.join(outDir, '__model_meta.ts'),
        generateAttributes: false,
    });

    generateIndex(project, outDir, models);

    models.forEach((dataModel) => {
        const mapping = dmmf.mappings.modelOperations.find((op) => op.model === dataModel.name);
        if (!mapping) {
            warnings.push(`Unable to find mapping for model ${dataModel.name}`);
            return;
        }
        generateModelApis(project, outDir, dataModel, mapping, options);
    });

    await saveProject(project);
    return { warnings };
}

function generateQueryApi(
    sf: SourceFile,
    model: string,
    operation: string,
    returnArray: boolean,
    optionalInput: boolean,
    overrideReturnType?: string,
    overrideInputType?: string,
    overrideTypeParameters?: string[],
    overrideApiOperation?: string,
    overrideFunctionName?: string,
    fetchRawResult = false
) {
    const capOperation = upperCaseFirst(operation);

    const argsType = overrideInputType ?? `Prisma.${model}${capOperation}Args`;
    const inputType = makeQueryArgsType(argsType);

    let defaultReturnType = `Prisma.${model}GetPayload<TArgs>`;
    if (returnArray) {
        defaultReturnType = `Array<${defaultReturnType}>`;
    }
    if (fetchRawResult === true) {
        defaultReturnType = `FindManyAndCountResult<${defaultReturnType}>`;
    }
    const returnType = overrideReturnType ?? defaultReturnType;

    const functionName = overrideFunctionName ?? `${operation}${model}`;
    const func = sf.addFunction({
        name: functionName,
        typeParameters: overrideTypeParameters ?? [`TArgs extends ${argsType}`],
        parameters: [
            {
                name: optionalInput ? 'args?' : 'args',
                type: inputType,
            },
        ],
        isExported: true,
    });

    const apiOperation = overrideApiOperation ?? operation;

    func.addStatements([
        makeGetContext(),
        `return apiModelQuery<${returnType}>('${model}', \`\${ctx.getRpcEndpoint()}/${lowerCaseFirst(
            model
        )}/${apiOperation}\`, args, ctx.request, ${fetchRawResult === true ? 'true' : 'false'});`,
    ]);
}

function generateMutationApi(
    sf: SourceFile,
    model: string,
    operation: string,
    httpVerb: 'post' | 'put' | 'delete' | 'patch',
    checkReadBack: boolean,
    overrideReturnType?: string,
    overrideTypeParameters?: string[],
    overrideApiOperation?: string,
    overrideFunctionName?: string,
    fetchRawResult?: boolean
) {
    const capOperation = upperCaseFirst(operation);

    const argsType = `Prisma.${model}${capOperation}Args`;
    const inputType = `Prisma.SelectSubset<TArgs, ${argsType}>`;
    let returnType = overrideReturnType ?? `CheckSelect<TArgs, ${model}, Prisma.${model}GetPayload<TArgs>>`;
    if (checkReadBack) {
        returnType = `(${returnType} | undefined )`;
    }
    const nonGenericArgsType = `${inputType}`;

    const functionName = overrideFunctionName ?? `${operation}${model}`;
    const func = sf.addFunction({
        name: functionName,
        isExported: true,
        typeParameters: overrideTypeParameters ?? [`TArgs extends ${argsType}`],
        parameters: [
            {
                name: 'args',
                type: nonGenericArgsType,
            },
        ],
    });

    const apiOperation = overrideApiOperation ?? operation;

    // get endpoint from context
    func.addStatements([
        makeGetContext(),
        `return apiModelMutation<${returnType}>('${model}', '${httpVerb.toUpperCase()}', \`\${ctx.getRpcEndpoint()}/${lowerCaseFirst(
            model
        )}/${apiOperation}\`, args, ctx.request, ${checkReadBack}, ${fetchRawResult === true ? 'true' : 'false'});`,
    ]);
}

function generateCheckApi(sf: SourceFile, model: DataModel, prismaImport: string) {
    const mapFilterType = (type: DataModelFieldType) => {
        return match(type.type)
            .with(P.union('Int', 'BigInt'), () => 'number')
            .with('String', () => 'string')
            .with('Boolean', () => 'boolean')
            .otherwise(() => undefined);
    };

    const filterFields: Array<{ name: string; type: string }> = [];
    const enumsToImport = new Set<string>();

    // collect filterable fields and enums to import
    model.fields.forEach((f) => {
        if (isEnum(f.type.reference?.ref)) {
            enumsToImport.add(f.type.reference.$refText);
            filterFields.push({ name: f.name, type: f.type.reference.$refText });
        }

        const mappedType = mapFilterType(f.type);
        if (mappedType) {
            filterFields.push({ name: f.name, type: mappedType });
        }
    });

    if (enumsToImport.size > 0) {
        // import enums
        const declares = sf.getImportDeclaration((importDeclaration) => {
            return importDeclaration.getText().includes(Array.from(enumsToImport).join(', '));
        });
        if (!declares) {
            sf.addStatements(`import type { ${Array.from(enumsToImport).join(', ')} } from '${prismaImport}';`);
        }
    }

    const whereType = `{ ${filterFields.map(({ name, type }) => `${name}?: ${type}`).join('; ')} }`;

    const func = sf.addFunction({
        name: `check${model.name}`,
        isExported: true,
        parameters: [{ name: 'args', type: `{ operation: PolicyCrudKind; where?: ${whereType}; }` }],
    });

    func.addStatements([
        makeGetContext(),
        `return apiModelQuery<boolean>('${model.name}', \`\${ctx.getRpcEndpoint()}/${lowerCaseFirst(
            model.name
        )}/check\`, args, ctx.request);`,
    ]);
}

function generateModelApis(
    project: Project,
    outDir: string,
    model: DataModel,
    mapping: DMMF.ModelMapping,
    options: PluginOptions
) {
    const modelNameCap = upperCaseFirst(model.name);
    const fileName = paramCase(model.name);

    const spath = path.join(outDir, `${fileName}.ts`);
    const prismaImport: string = options?.prismaImport
        ? `${options?.prismaImport}`
        : getPrismaClientImportSpec(outDir, options);
    let sf = project.getSourceFile(spath);
    if (!sf) {
        sf = project.createSourceFile(spath, undefined, { overwrite: true });
        sf.addStatements('/* eslint-disable */');
        sf.addImportDeclaration({
            namedImports: ['Prisma', model.name],
            isTypeOnly: true,
            moduleSpecifier: prismaImport,
        });
        sf.addStatements(makeBaseImports(options));
    }

    // Note: delegate models don't support create and upsert operations

    // create is somehow named "createOne" in the DMMF
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!isDelegateModel(model) && (mapping.create || (mapping as any).createOne)) {
        generateMutationApi(sf, model.name, 'create', 'post', true);
    }

    // createMany
    if (!isDelegateModel(model) && mapping.createMany && supportCreateMany(model.$container)) {
        generateMutationApi(sf, model.name, 'createMany', 'post', false, 'Prisma.BatchPayload');
        generateMutationApi(sf, model.name, 'createManyAndReturn', 'post', true);
    }

    // findMany
    if (mapping.findMany) {
        // regular findMany
        generateQueryApi(sf, model.name, 'findMany', true, true, undefined, undefined, undefined);
    }

    // findUnique
    if (mapping.findUnique) {
        generateQueryApi(sf, model.name, 'findUnique', false, false, undefined, undefined, undefined);
    }

    // findFirst
    if (mapping.findFirst) {
        generateQueryApi(sf, model.name, 'findFirst', false, true, undefined, undefined, undefined);
    }

    // update
    // update is somehow named "updateOne" in the DMMF
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (mapping.update || (mapping as any).updateOne) {
        generateMutationApi(sf, model.name, 'update', 'put', true);
    }

    // updateMany
    if (mapping.updateMany) {
        generateMutationApi(sf, model.name, 'updateMany', 'put', false, 'Prisma.BatchPayload');
    }

    // upsert
    // upsert is somehow named "upsertOne" in the DMMF
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!isDelegateModel(model) && (mapping.upsert || (mapping as any).upsertOne)) {
        generateMutationApi(sf, model.name, 'upsert', 'post', true);
    }

    // del
    // delete is somehow named "deleteOne" in the DMMF
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (mapping.delete || (mapping as any).deleteOne) {
        generateMutationApi(sf, model.name, 'delete', 'delete', true);
    }

    // deleteMany
    if (mapping.deleteMany) {
        generateMutationApi(sf, model.name, 'deleteMany', 'delete', false, 'Prisma.BatchPayload');
    }

    // aggregate
    if (mapping.aggregate) {
        generateQueryApi(sf, modelNameCap, 'aggregate', false, false, `Prisma.Get${modelNameCap}AggregateType<TArgs>`);
    }

    // groupBy
    if (mapping.groupBy) {
        const useName = model.name;

        const returnType = `{} extends InputErrors ?
      Array<PickEnumerable<Prisma.${modelNameCap}GroupByOutputType, TArgs['by']> &
        {
          [P in ((keyof TArgs) & (keyof Prisma.${modelNameCap}GroupByOutputType))]: P extends '_count'
            ? TArgs[P] extends boolean
              ? number
              : Prisma.GetScalarType<TArgs[P], Prisma.${modelNameCap}GroupByOutputType[P]>
            : Prisma.GetScalarType<TArgs[P], Prisma.${modelNameCap}GroupByOutputType[P]>
        }
      > : InputErrors`;

        const typeParameters = [
            `TArgs extends Prisma.${useName}GroupByArgs`,
            `HasSelectOrTake extends Prisma.Or<Prisma.Extends<'skip', Prisma.Keys<TArgs>>, Prisma.Extends<'take', Prisma.Keys<TArgs>>>`,
            `OrderByArg extends Prisma.True extends HasSelectOrTake ? { orderBy: Prisma.${useName}GroupByArgs['orderBy'] }: { orderBy?: Prisma.${useName}GroupByArgs['orderBy'] },`,
            `OrderFields extends Prisma.ExcludeUnderscoreKeys<Prisma.Keys<Prisma.MaybeTupleToUnion<TArgs['orderBy']>>>`,
            `ByFields extends Prisma.MaybeTupleToUnion<TArgs['by']>`,
            `ByValid extends Prisma.Has<ByFields, OrderFields>`,
            `HavingFields extends Prisma.GetHavingFields<TArgs['having']>`,
            `HavingValid extends Prisma.Has<ByFields, HavingFields>`,
            `ByEmpty extends TArgs['by'] extends never[] ? Prisma.True : Prisma.False`,
            `InputErrors extends ByEmpty extends Prisma.True
          ? \`Error: "by" must not be empty.\`
          : HavingValid extends Prisma.False
          ? {
              [P in HavingFields]: P extends ByFields
              ? never
              : P extends string
              ? \`Error: Field "\${P}" used in "having" needs to be provided in "by".\`
              : [
                  Error,
                  'Field ',
                  P,
                  \` in "having" needs to be provided in "by"\`,
                  ]
          }[HavingFields]
          : 'take' extends Prisma.Keys<TArgs>
          ? 'orderBy' extends Prisma.Keys<TArgs>
          ? ByValid extends Prisma.True
              ? {}
              : {
                  [P in OrderFields]: P extends ByFields
                  ? never
                  : \`Error: Field "\${P}" in "orderBy" needs to be provided in "by"\`
              }[OrderFields]
          : 'Error: If you provide "take", you also need to provide "orderBy"'
          : 'skip' extends Prisma.Keys<TArgs>
          ? 'orderBy' extends Prisma.Keys<TArgs>
          ? ByValid extends Prisma.True
              ? {}
              : {
                  [P in OrderFields]: P extends ByFields
                  ? never
                  : \`Error: Field "\${P}" in "orderBy" needs to be provided in "by"\`
              }[OrderFields]
          : 'Error: If you provide "skip", you also need to provide "orderBy"'
          : ByValid extends Prisma.True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
              ? never
              : \`Error: Field "\${P}" in "orderBy" needs to be provided in "by"\`
          }[OrderFields]`,
        ];

        generateQueryApi(
            sf,
            model.name,
            'groupBy',
            false,
            false,
            returnType,
            `Prisma.SubsetIntersection<TArgs, Prisma.${useName}GroupByArgs, OrderByArg> & InputErrors`,
            typeParameters
        );
    }

    // somehow dmmf doesn't contain "count" operation, so we unconditionally add it here
    {
        generateQueryApi(
            sf,
            model.name,
            'count',
            false,
            true,
            `TArgs extends { select: any; } ? TArgs['select'] extends true ? number : Prisma.GetScalarType<TArgs['select'], Prisma.${modelNameCap}CountAggregateOutputType> : number`
        );
    }

    {
        // findMany with count
        generateQueryApi(
            sf,
            model.name,
            'findMany',
            true,
            true,
            undefined,
            undefined,
            undefined,
            undefined,
            `findManyAndCount${model.name}`,
            true
        );
    }

    {
        // extra `check` hook for ZenStack's permission checker API
        generateCheckApi(sf, model, prismaImport);
    }
}

function generateIndex(project: Project, outDir: string, models: DataModel[]) {
    const sf = project.createSourceFile(path.join(outDir, 'index.ts'), undefined, { overwrite: true });
    sf.addStatements(models.map((d) => `export * from './${paramCase(d.name)}';`));
}

function makeGetContext() {
    return 'const ctx = getApiContext();';
}

function makeBaseImports(options: PluginOptions) {
    const shared = [];

    const contextImport = options?.contextImport ? `${options?.contextImport}` : '../context';

    shared.push(
        `import { getApiContext } from '${contextImport}';`,
        `import type { CheckSelect, FindManyAndCountResult, PickEnumerable, PolicyCrudKind } from '@zsjinwei/api-query/runtime';`,
        `import { apiModelMutation, apiModelQuery } from '@zsjinwei/api-query/runtime';`
    );

    return [...shared];
}

function makeQueryArgsType(argsType: string) {
    const type = `Prisma.SelectSubset<TArgs, ${argsType}>`;
    return `${type}`;
}
