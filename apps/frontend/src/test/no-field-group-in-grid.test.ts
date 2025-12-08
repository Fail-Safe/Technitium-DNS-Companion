import { ESLint } from 'eslint'
import type { Linter, Rule } from 'eslint'
import { describe, expect, it } from 'vitest'
import parser from '@typescript-eslint/parser'
import noFieldGroupRule from '../../eslint-rules/no-field-group-in-grid-clean'

const overrideConfig: Linter.Config = {
    languageOptions: {
        parser,
        parserOptions: { ecmaVersion: 2020 as const, sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    plugins: { '__test_local_rules': { rules: { 'no-field-group-in-grid': noFieldGroupRule as Rule.RuleModule } } },
    rules: { '__test_local_rules/no-field-group-in-grid': ['error'] },
}

describe('no-field-group-in-grid ESLint rule', () => {
    it('flags field-group inside an ancestor with __grid class', async () => {
        const code = `import React from 'react'; export default function Test(){ return (<div className='foo__grid'><div className='field-group'>Hello</div></div>) }`
        const eslint = new ESLint({ overrideConfig })
        const results = await eslint.lintText(code, { filePath: 'test.tsx' })
        const messages = results[0].messages
        expect(messages.some(m => /field-group/.test(m.message))).toBe(true)
    })

    it('does not flag field-group outside grid contexts', async () => {
        const code = `import React from 'react'; export default function Test(){ return (<div className='foo__container'><div className='field-group'>Hello</div></div>) }`
        const eslint = new ESLint({ overrideConfig })
        const results = await eslint.lintText(code, { filePath: 'test.tsx' })
        const messages = results[0].messages
        expect(messages.length).toBe(0)
    })
})

