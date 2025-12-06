const esbuild = require('esbuild');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
    const ctx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/extension.js',
        external: [
            'vscode',
            // ESM-only markdown dependencies
            'unified',
            'remark-parse',
            'remark-gfm',
            'remark-math',
            'remark-rehype',
            'rehype-katex',
            'rehype-stringify',
            'unist-util-visit',
            // These dependencies of the above packages are also ESM-only
            'bail',
            'is-plain-obj',
            'trough',
            'vfile',
            'vfile-message',
            'unist-util-stringify-position',
            'unist-util-visit-parents',
            'unist-util-is',
            'mdast-util-*',
            'micromark*',
            'hast-util-*',
            'katex',
            // sql.js uses WASM and needs special handling
            'sql.js'
        ],
        logLevel: 'info',
    });

    if (watch) {
        await ctx.watch();
        console.log('Watching for changes...');
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});

