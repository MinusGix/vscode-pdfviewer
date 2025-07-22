/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.ts'],
        typecheck: {
            tsconfig: './tsconfig.json'
        },
        watch: false,
        mockReset: true,
        setupFiles: ['src/test/setup.ts'],
    },
}); 