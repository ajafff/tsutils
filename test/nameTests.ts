import { assert } from 'chai';
import { isValidPropertyName, isValidIdentifier, isValidPropertyAccess, isValidNumericLiteral, isValidJsxIdentifier } from '../util/util';

const irregular = [
    '\uFEFFtest',
    '\\uFEFFtest',
    '\uFEFF1',
    '\\uFEFF1',
    '\ntest',
    '\\ntest',
];

describe('isValidPropertyName', () => {
    it('handles irregular whitespace', () => {
        for (const name of irregular)
            assert.equal(isValidPropertyName(name), false, name);
    });

    it('handles empty string', () => {
        assert.equal(isValidPropertyName(''), false);
    });

    it('works as expected', () => {
        const tests: Array<[string, boolean]> = [
            ['a', true],
            ['_a', true],
            ['a-b', false],
            ['-1', false],
            ['1foo', false],
            ['foo1', true],
            ['\n', false],
            [' ', false],
            ['a b', false],
            ['a,b', false],
            ['a + b', false],
            ['1', true],
            ['1.0', false],
            ['1.1', true],
            ['+1', false],
            ['true', true],
            ['false', true],
            ['catch', true],
            ['try', true],
            ['1_2_3', false],
        ];
        for (const test of tests)
            assert.equal(isValidPropertyName(test[0]), test[1], test[0]);
    });
});

describe('isValidPropertyAccess', () => {
    it('handles irregular whitespace', () => {
        for (const name of irregular)
            assert.equal(isValidPropertyAccess(name), false, name);
    });

    it('handles empty string', () => {
        assert.equal(isValidPropertyAccess(''), false);
    });

    it('works as expected', () => {
        const tests: Array<[string, boolean]> = [
            ['a', true],
            ['_a', true],
            ['a-b', false],
            ['-1', false],
            ['1foo', false],
            ['foo1', true],
            ['\n', false],
            [' ', false],
            ['a b', false],
            ['a,b', false],
            ['a + b', false],
            ['1', false],
            ['1.0', false],
            ['1.1', false],
            ['+1', false],
            ['true', true],
            ['false', true],
            ['catch', true],
            ['try', true],
            ['1_2_3', false],
        ];
        for (const test of tests)
            assert.equal(isValidPropertyAccess(test[0]), test[1], test[0]);
    });
});

describe('isValidIdentifier', () => {
    it('handles irregular whitespace', () => {
        for (const name of irregular)
            assert.equal(isValidIdentifier(name), false, name);
    });

    it('handles empty string', () => {
        assert.equal(isValidIdentifier(''), false);
    });

    it('works as expected', () => {
        const tests: Array<[string, boolean]> = [
            ['a', true],
            ['_a', true],
            ['a-b', false],
            ['-1', false],
            ['1foo', false],
            ['foo1', true],
            ['\n', false],
            [' ', false],
            ['a b', false],
            ['a,b', false],
            ['a + b', false],
            ['1', false],
            ['1.0', false],
            ['1.1', false],
            ['+1', false],
            ['true', false],
            ['false', false],
            ['catch', false],
            ['try', false],
            ['1_2_3', false],
        ];
        for (const test of tests)
            assert.equal(isValidIdentifier(test[0]), test[1], test[0]);
    });
});

describe('isValidNumericLiteral', () => {
    it('handles irregular whitespace', () => {
        for (const name of irregular)
            assert.equal(isValidNumericLiteral(name), false, name);
    });

    it('handles empty string', () => {
        assert.equal(isValidNumericLiteral(''), false);
    });

    it('works as expected', () => {
        const tests: Array<[string, boolean]> = [
            ['a', false],
            ['_a', false],
            ['a-b', false],
            ['-1', false],
            ['1foo', false],
            ['foo1', false],
            ['\n', false],
            [' ', false],
            ['a b', false],
            ['a,b', false],
            ['a + b', false],
            ['1', true],
            ['1.0', true],
            ['1.1', true],
            ['+1', false],
            ['true', false],
            ['false', false],
            ['catch', false],
            ['try', false],
            ['1_2_3', true],
            ['_1', false],
            ['1_2_', true],
            ['1__2', true],
            ['1_2.3', true],
        ];
        for (const test of tests)
            assert.equal(isValidNumericLiteral(test[0]), test[1], test[0]);
    });
});

describe('isValidJsxIdentifier', () => {
    it('handles irregular whitespace', () => {
        for (const name of irregular)
            assert.equal(isValidJsxIdentifier(name), false, name);
    });

    it('handles empty string', () => {
        assert.equal(isValidJsxIdentifier(''), false);
    });

    it('works as expected', () => {
        const tests: Array<[string, boolean]> = [
            ['-', false],
            ['a', true],
            ['_a', true],
            ['a-b', true],
            ['a--b', true],
            ['a-b-', true],
            ['a-b-c', true],
            ['new-b', true],
            ['-a-b', false],
            ['a-1', true],
            ['1-a', false],
            ['-1', false],
            ['1foo', false],
            ['foo1', true],
            ['\n', false],
            [' ', false],
            ['a b', false],
            ['a,b', false],
            ['a + b', false],
            ['1', false],
            ['1.0', false],
            ['1.1', false],
            ['+1', false],
            ['true', true],
            ['false', true],
            ['catch', true],
            ['try', true],
            ['1_2_3', false],
        ];
        for (const test of tests)
            assert.equal(isValidJsxIdentifier(test[0]), test[1], test[0]);
    });
});
