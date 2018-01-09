grammar YAJS;

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

projectExpression
  : Identifier+
  ;

filterExpression
  : filterExpressionTerm+
  ;

filterExpressionTerm
  : (AND | OR) filterExpressionTerm
  | NOT filterExpressionTerm
  | LP filterExpression RP
  | key=Identifier
  ;

Identifier
  : ~('.'|'!'|' '|'\t'|'('|
      ')'|'&'|'|'|'['|']'|
      '{'|'}'|'$'|'*')+
  ;

ROOT : '$' ;
DOT  : '.' ;
AND  : '&&';
OR   : '||';
NOT  : '!' ;
LP   : '(' ;
RP   : ')' ;
LB   : '{' ;
RB   : '}' ;
LSB  : '[' ;
RSB  : ']' ;
STAR : '*' ;

Whitespace
  : (' '|'\t')+ ->skip
  ;