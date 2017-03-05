# Change Log

## v1.1.0
**Bugfixes:**
* Fix isBlockScopeBoundary: Remove WithStatement, IfStatment, DoStatement and WhileStatement because they are no scope boundary whitout a block.

**Features:**
* Added more typeguards:
  * isAssertionExpression
  * isEmptyStatement
  * isJsxAttributeLike
  * isJsxOpeningLikeElement
  * isNonNullExpression
  * isSyntaxList
* Utilities:
  * getNextToken, getPreviousToken
  * hasOwnThisReference
  * getLineRanges


## v1.0.0
**Features:**

* Initial implementation of typeguards
* Utilities:
  * getChildOfKind
  * isNodeKind, isAssignmentKind
  * hasModifier, isParameterProperty, hasAccessModifier
  * getPreviousStatement, getNextStatement
  * getPropertyName
  * forEachDestructuringIdentifier, forEachDeclaredVariable
  * getVariableDeclarationKind, isBlockScopedVariableDeclarationList, isBlockScopedVariableDeclaration
  * isScopeBoundary, isFunctionScopeBoundary, isBlockScopeBoundary
  * forEachToken, forEachTokenWithTrivia, forEachComment
  * endsControlFlow