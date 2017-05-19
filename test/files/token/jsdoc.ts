/** some jsdoc */
function foo({bar: _bar}: Baz) {}

/**
 * some more jsdoc
 * @deprecated
 */
class Baz {
    public readonly bar?: Baz;
}
