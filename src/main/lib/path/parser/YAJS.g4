grammar YAJS;

@lexer::members {
    private expression = false;
}

path
  : ROOT pathStep* pathLeaf? EOF
  ;

pathStep
  : DOT DOT? actionFilter? actionField
  ;

actionField
  : key=STAR
  | key=Identifier
  ;

actionFilter
  : LSB filterExpression RSB
  ;

// Issue #95: project ({...}) and drop-keys (<...>) may now appear together
// on the same terminal - grammar-level, both written orders parse cleanly
// (actionProject/actionDropKeys are each optional here, in both
// alternatives) so that a selector combining them the "wrong" way (either
// order isn't automatically allowed - see below) fails with a clear,
// purpose-built message instead of a raw ANTLR "mismatched input" error.
// Whether a given combination is actually ALLOWED is a semantic question
// the parse tree alone can't express - see YAJSPath.ts's
// Visitor.visitPathLeaf(), which enforces both rules after parsing:
//  - only the project-then-drop-keys written order is ever combinable
//    (matching #95's own proposed syntax, `{key1}<key2>`) - the reversed
//    order is always rejected, regardless of regex use;
//  - even in that order, combining is only allowed when at least one side
//    uses the regex primitive (REGEX below, issue #96) - a pure-literal
//    combination like `{key1}<key2>` stays rejected exactly as before.
pathLeaf
  : actionProject actionDropKeys?
  | actionDropKeys actionProject?
  ;

actionProject
  : LB filterExpression RB
  ;

actionDropKeys
  : LT filterExpression GT
  ;

filterExpression
  : filterExpressionTerm+
  ;

filterExpressionTerm
  : op=(AND | OR) term=filterExpressionTerm
  | op=NOT term=filterExpressionTerm
  | LP expr=filterExpression RP
  | key=FilterExpressionTerm
  | regex=REGEX
  ;

LB   : '{' { this.expression = true;  };
RB   : '}' { this.expression = false; };
LSB  : '[' { this.expression = true;  };
RSB  : ']' { this.expression = false; };
LT   : '<' { this.expression = true; };
GT   : '>' { this.expression = false; };

Identifier
  : ~('.'|'!'|' '|'\t'|'('|'>'|
      ')'|'&'|'|'|'[' |']'|'<'|
      '{'|'}'|'$'|'*' )+ { this.expression === false; }?
  ;

// Issue #96: regex filter primitive, e.g. `{/^key\d+$/}` - slash-delimited,
// mirroring JS regex literal syntax (the "open design question" in #96
// weighed this against the user's own backslash-delimited shorthand;
// backslash was rejected because it already means something inside a
// selector's own string-escaping rules elsewhere, risking lexer ambiguity,
// while '/' is unused anywhere else in this grammar - no division operator
// exists here to collide with). Deliberately defined ABOVE
// FilterExpressionTerm: nothing in FilterExpressionTerm's own character
// class excludes '/', so for a plain pattern (no chars FilterExpressionTerm
// itself excludes, e.g. `/foo/`) both rules match the identical span, and
// ANTLR's tie-break for equal-length matches is "whichever rule is defined
// first wins" - REGEX must win that tie so `{/foo/}` compiles to a regex
// primitive, not a literal bare key named "/foo/". Whenever the pattern
// contains a char FilterExpressionTerm itself excludes (e.g. `/a|b/`,
// `/(x)/`), REGEX wins on its own regardless of ordering, since it produces
// the strictly longer match (FilterExpressionTerm's own maximal munch stops
// at the excluded char). One accepted consequence either way: a selector
// can no longer address a literal key whose name is itself exactly
// slash-framed (e.g. a JSON key genuinely named "/foo/") via the bare-key
// filter syntax - REGEX always claims that shape now, the same trade-off a
// JS identifier named exactly like a regex literal would run into.
REGEX
  : '/' (~('/'|'\r'|'\n'))* '/' { this.expression === true; }?
  ;

FilterExpressionTerm
  : ~('!'|' '|'\t'|'('|'>'|
      ')'|'&'|'|' |'['|'<'|
      '{'|'}'|']')+ { this.expression === true; }?
  ;

ROOT : '$' { this.expression === false; }?;
DOT  : '.' { this.expression === false; }?;
STAR : '*' { this.expression === false; }?;

AND  : '&&';
OR   : '||';
NOT  : '!' ;
LP   : '(' ;
RP   : ')' ;


Whitespace
  : (' '|'\t')+ ->skip
  ;