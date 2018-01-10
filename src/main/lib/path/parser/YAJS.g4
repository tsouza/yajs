grammar YAJS;

@lexer::members {
    private expression = false;
}

path
  : ROOT pathStep* (actionProject EOF)?
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

actionProject
  : LB filterExpression RB
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

Identifier
  : ~('.'|'!'|' '|'\t'|'('|
      ')'|'&'|'|'|'[' |']'|
      '{'|'}'|'$'|'*' )+ { this.expression === false; }?
  ;

FilterExpressionTerm
  : ~('!'|' '|'\t'|'('|
      ')'|'&'|'|' |'['|
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