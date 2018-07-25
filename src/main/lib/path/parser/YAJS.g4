grammar YAJS;

@lexer::members {
    private expression = false;
}

path
  : ROOT pathStep* (pathLeaf EOF)?
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

pathLeaf
  : actionProject
  | actionDropKeys
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