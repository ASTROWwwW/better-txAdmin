import path from 'node:path';
import fs from 'node:fs';
import { defineConfig } from 'vitest/config';
import type { InlineConfig } from 'vitest/node';


//Detect the aliases from the tsconfig.json
//NOTE: this regex is obviously sensitive to the format of the tsconfig.json
// but I don't feel like using a jsonc parser in here
const tsconfig = fs.readFileSync(path.resolve(__dirname, './tsconfig.json'), 'utf-8');
const aliasRegex = /"(?<alias>@\w+)\/\*":\s\["(?<path>\.+\/[^*]*)\*"]/g;
const resolvedAliases: Record<string, string> = {
    '@locale': path.resolve(__dirname, '../locale'), //from ./shared/tsconfig.json
};
for (const match of tsconfig.matchAll(aliasRegex)) {
    resolvedAliases[match.groups!.alias] = path.resolve(__dirname, match.groups!.path);
}


//Some .js files import .ts files by their .js name, which esbuild resolves and vite does not.
//NOTE: only the first matching alias is applied, so the tsconfig ones need their own .js variant
const jsToTsAliases = [
    { find: /^(\.{1,2}\/.+)\.js$/, replacement: '$1' },
    ...Object.entries(resolvedAliases).map(([alias, target]) => ({
        find: new RegExp(`^${alias}/(.+)\\.js$`),
        replacement: `${target}/$1`,
    })),
];

export default defineConfig({
    test: {
        globalSetup: './testing/globalSetup.ts',
        setupFiles: ['./testing/fileSetup.ts'],
        alias: [
            ...jsToTsAliases,
            ...Object.entries(resolvedAliases).map(([find, replacement]) => ({ find, replacement })),
        ],
    },
});
