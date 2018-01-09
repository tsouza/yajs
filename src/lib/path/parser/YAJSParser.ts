// Generated from src/lib/path/parser/YAJS.g4 by ANTLR 4.6-SNAPSHOT


import { ATN } from 'antlr4ts/atn/ATN';
import { ATNDeserializer } from 'antlr4ts/atn/ATNDeserializer';
import { FailedPredicateException } from 'antlr4ts/FailedPredicateException';
import { NotNull } from 'antlr4ts/Decorators';
import { NoViableAltException } from 'antlr4ts/NoViableAltException';
import { Override } from 'antlr4ts/Decorators';
import { Parser } from 'antlr4ts/Parser';
import { ParserRuleContext } from 'antlr4ts/ParserRuleContext';
import { ParserATNSimulator } from 'antlr4ts/atn/ParserATNSimulator';
import { ParseTreeListener } from 'antlr4ts/tree/ParseTreeListener';
import { ParseTreeVisitor } from 'antlr4ts/tree/ParseTreeVisitor';
import { RecognitionException } from 'antlr4ts/RecognitionException';
import { RuleContext } from 'antlr4ts/RuleContext';
import { RuleVersion } from 'antlr4ts/RuleVersion';
import { TerminalNode } from 'antlr4ts/tree/TerminalNode';
import { Token } from 'antlr4ts/Token';
import { TokenStream } from 'antlr4ts/TokenStream';
import { Vocabulary } from 'antlr4ts/Vocabulary';
import { VocabularyImpl } from 'antlr4ts/VocabularyImpl';

import * as Utils from 'antlr4ts/misc/Utils';

import { YAJSVisitor } from './YAJSVisitor';


export class YAJSParser extends Parser {
	public static readonly Identifier=1;
	public static readonly ROOT=2;
	public static readonly DOT=3;
	public static readonly AND=4;
	public static readonly OR=5;
	public static readonly NOT=6;
	public static readonly LP=7;
	public static readonly RP=8;
	public static readonly LB=9;
	public static readonly RB=10;
	public static readonly LSB=11;
	public static readonly RSB=12;
	public static readonly STAR=13;
	public static readonly Whitespace=14;
	public static readonly RULE_path = 0;
	public static readonly RULE_pathStep = 1;
	public static readonly RULE_actionField = 2;
	public static readonly RULE_actionFilter = 3;
	public static readonly RULE_actionProject = 4;
	public static readonly RULE_projectExpression = 5;
	public static readonly RULE_filterExpression = 6;
	public static readonly RULE_filterExpressionTerm = 7;
	public static readonly ruleNames: string[] = [
		"path", "pathStep", "actionField", "actionFilter", "actionProject", "projectExpression", 
		"filterExpression", "filterExpressionTerm"
	];

	private static readonly _LITERAL_NAMES: (string | undefined)[] = [
		undefined, undefined, "'$'", "'.'", "'&&'", "'||'", "'!'", "'('", "')'", 
		"'{'", "'}'", "'['", "']'", "'*'"
	];
	private static readonly _SYMBOLIC_NAMES: (string | undefined)[] = [
		undefined, "Identifier", "ROOT", "DOT", "AND", "OR", "NOT", "LP", "RP", 
		"LB", "RB", "LSB", "RSB", "STAR", "Whitespace"
	];
	public static readonly VOCABULARY: Vocabulary = new VocabularyImpl(YAJSParser._LITERAL_NAMES, YAJSParser._SYMBOLIC_NAMES, []);

	@Override
	@NotNull
	public get vocabulary(): Vocabulary {
		return YAJSParser.VOCABULARY;
	}

	@Override
	public get grammarFileName(): string { return "YAJS.g4"; }

	@Override
	public get ruleNames(): string[] { return YAJSParser.ruleNames; }

	@Override
	public get serializedATN(): string { return YAJSParser._serializedATN; }

	constructor(input: TokenStream) {
		super(input);
		this._interp = new ParserATNSimulator(YAJSParser._ATN, this);
	}
	@RuleVersion(0)
	public path(): PathContext {
		let _localctx: PathContext = new PathContext(this._ctx, this.state);
		this.enterRule(_localctx, 0, YAJSParser.RULE_path);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 16;
			this.match(YAJSParser.ROOT);
			this.state = 20;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===YAJSParser.DOT) {
				{
				{
				this.state = 17;
				this.pathStep();
				}
				}
				this.state = 22;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 26;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===YAJSParser.LB) {
				{
				this.state = 23;
				this.actionProject();
				this.state = 24;
				this.match(YAJSParser.EOF);
				}
			}

			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public pathStep(): PathStepContext {
		let _localctx: PathStepContext = new PathStepContext(this._ctx, this.state);
		this.enterRule(_localctx, 2, YAJSParser.RULE_pathStep);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 28;
			this.match(YAJSParser.DOT);
			this.state = 30;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===YAJSParser.DOT) {
				{
				this.state = 29;
				this.match(YAJSParser.DOT);
				}
			}

			this.state = 33;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===YAJSParser.LSB) {
				{
				this.state = 32;
				this.actionFilter();
				}
			}

			this.state = 35;
			this.actionField();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public actionField(): ActionFieldContext {
		let _localctx: ActionFieldContext = new ActionFieldContext(this._ctx, this.state);
		this.enterRule(_localctx, 4, YAJSParser.RULE_actionField);
		try {
			this.state = 39;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case YAJSParser.STAR:
				this.enterOuterAlt(_localctx, 1);
				{
				this.state = 37;
				_localctx._key = this.match(YAJSParser.STAR);
				}
				break;
			case YAJSParser.Identifier:
				this.enterOuterAlt(_localctx, 2);
				{
				this.state = 38;
				_localctx._key = this.match(YAJSParser.Identifier);
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public actionFilter(): ActionFilterContext {
		let _localctx: ActionFilterContext = new ActionFilterContext(this._ctx, this.state);
		this.enterRule(_localctx, 6, YAJSParser.RULE_actionFilter);
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 41;
			this.match(YAJSParser.LSB);
			this.state = 42;
			this.filterExpression();
			this.state = 43;
			this.match(YAJSParser.RSB);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public actionProject(): ActionProjectContext {
		let _localctx: ActionProjectContext = new ActionProjectContext(this._ctx, this.state);
		this.enterRule(_localctx, 8, YAJSParser.RULE_actionProject);
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 45;
			this.match(YAJSParser.LB);
			this.state = 46;
			this.projectExpression();
			this.state = 47;
			this.match(YAJSParser.RB);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public projectExpression(): ProjectExpressionContext {
		let _localctx: ProjectExpressionContext = new ProjectExpressionContext(this._ctx, this.state);
		this.enterRule(_localctx, 10, YAJSParser.RULE_projectExpression);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 50; 
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			do {
				{
				{
				this.state = 49;
				this.match(YAJSParser.Identifier);
				}
				}
				this.state = 52; 
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			} while ( _la===YAJSParser.Identifier );
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public filterExpression(): FilterExpressionContext {
		let _localctx: FilterExpressionContext = new FilterExpressionContext(this._ctx, this.state);
		this.enterRule(_localctx, 12, YAJSParser.RULE_filterExpression);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 55; 
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			do {
				{
				{
				this.state = 54;
				this.filterExpressionTerm();
				}
				}
				this.state = 57; 
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			} while ( (((_la) & ~0x1F) === 0 && ((1 << _la) & ((1 << YAJSParser.Identifier) | (1 << YAJSParser.AND) | (1 << YAJSParser.OR) | (1 << YAJSParser.NOT) | (1 << YAJSParser.LP))) !== 0) );
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public filterExpressionTerm(): FilterExpressionTermContext {
		let _localctx: FilterExpressionTermContext = new FilterExpressionTermContext(this._ctx, this.state);
		this.enterRule(_localctx, 14, YAJSParser.RULE_filterExpressionTerm);
		let _la: number;
		try {
			this.state = 68;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case YAJSParser.AND:
			case YAJSParser.OR:
				this.enterOuterAlt(_localctx, 1);
				{
				this.state = 59;
				_la = this._input.LA(1);
				if ( !(_la===YAJSParser.AND || _la===YAJSParser.OR) ) {
				this._errHandler.recoverInline(this);
				} else {
					if (this._input.LA(1) === Token.EOF) {
						this.matchedEOF = true;
					}

					this._errHandler.reportMatch(this);
					this.consume();
				}
				this.state = 60;
				this.filterExpressionTerm();
				}
				break;
			case YAJSParser.NOT:
				this.enterOuterAlt(_localctx, 2);
				{
				this.state = 61;
				this.match(YAJSParser.NOT);
				this.state = 62;
				this.filterExpressionTerm();
				}
				break;
			case YAJSParser.LP:
				this.enterOuterAlt(_localctx, 3);
				{
				this.state = 63;
				this.match(YAJSParser.LP);
				this.state = 64;
				this.filterExpression();
				this.state = 65;
				this.match(YAJSParser.RP);
				}
				break;
			case YAJSParser.Identifier:
				this.enterOuterAlt(_localctx, 4);
				{
				this.state = 67;
				_localctx._key = this.match(YAJSParser.Identifier);
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}

	public static readonly _serializedATN: string =
		"\x03\uAF6F\u8320\u479D\uB75C\u4880\u1605\u191C\uAB37\x03\x10I\x04\x02"+
		"\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04\x07"+
		"\t\x07\x04\b\t\b\x04\t\t\t\x03\x02\x03\x02\x07\x02\x15\n\x02\f\x02\x0E"+
		"\x02\x18\v\x02\x03\x02\x03\x02\x03\x02\x05\x02\x1D\n\x02\x03\x03\x03\x03"+
		"\x05\x03!\n\x03\x03\x03\x05\x03$\n\x03\x03\x03\x03\x03\x03\x04\x03\x04"+
		"\x05\x04*\n\x04\x03\x05\x03\x05\x03\x05\x03\x05\x03\x06\x03\x06\x03\x06"+
		"\x03\x06\x03\x07\x06\x075\n\x07\r\x07\x0E\x076\x03\b\x06\b:\n\b\r\b\x0E"+
		"\b;\x03\t\x03\t\x03\t\x03\t\x03\t\x03\t\x03\t\x03\t\x03\t\x05\tG\n\t\x03"+
		"\t\x02\x02\x02\n\x02\x02\x04\x02\x06\x02\b\x02\n\x02\f\x02\x0E\x02\x10"+
		"\x02\x02\x03\x03\x02\x06\x07J\x02\x12\x03\x02\x02\x02\x04\x1E\x03\x02"+
		"\x02\x02\x06)\x03\x02\x02\x02\b+\x03\x02\x02\x02\n/\x03\x02\x02\x02\f"+
		"4\x03\x02\x02\x02\x0E9\x03\x02\x02\x02\x10F\x03\x02\x02\x02\x12\x16\x07"+
		"\x04\x02\x02\x13\x15\x05\x04\x03\x02\x14\x13\x03\x02\x02\x02\x15\x18\x03"+
		"\x02\x02\x02\x16\x14\x03\x02\x02\x02\x16\x17\x03\x02\x02\x02\x17\x1C\x03"+
		"\x02\x02\x02\x18\x16\x03\x02\x02\x02\x19\x1A\x05\n\x06\x02\x1A\x1B\x07"+
		"\x02\x02\x03\x1B\x1D\x03\x02\x02\x02\x1C\x19\x03\x02\x02\x02\x1C\x1D\x03"+
		"\x02\x02\x02\x1D\x03\x03\x02\x02\x02\x1E \x07\x05\x02\x02\x1F!\x07\x05"+
		"\x02\x02 \x1F\x03\x02\x02\x02 !\x03\x02\x02\x02!#\x03\x02\x02\x02\"$\x05"+
		"\b\x05\x02#\"\x03\x02\x02\x02#$\x03\x02\x02\x02$%\x03\x02\x02\x02%&\x05"+
		"\x06\x04\x02&\x05\x03\x02\x02\x02\'*\x07\x0F\x02\x02(*\x07\x03\x02\x02"+
		")\'\x03\x02\x02\x02)(\x03\x02\x02\x02*\x07\x03\x02\x02\x02+,\x07\r\x02"+
		"\x02,-\x05\x0E\b\x02-.\x07\x0E\x02\x02.\t\x03\x02\x02\x02/0\x07\v\x02"+
		"\x0201\x05\f\x07\x0212\x07\f\x02\x022\v\x03\x02\x02\x0235\x07\x03\x02"+
		"\x0243\x03\x02\x02\x0256\x03\x02\x02\x0264\x03\x02\x02\x0267\x03\x02\x02"+
		"\x027\r\x03\x02\x02\x028:\x05\x10\t\x0298\x03\x02\x02\x02:;\x03\x02\x02"+
		"\x02;9\x03\x02\x02\x02;<\x03\x02\x02\x02<\x0F\x03\x02\x02\x02=>\t\x02"+
		"\x02\x02>G\x05\x10\t\x02?@\x07\b\x02\x02@G\x05\x10\t\x02AB\x07\t\x02\x02"+
		"BC\x05\x0E\b\x02CD\x07\n\x02\x02DG\x03\x02\x02\x02EG\x07\x03\x02\x02F"+
		"=\x03\x02\x02\x02F?\x03\x02\x02\x02FA\x03\x02\x02\x02FE\x03\x02\x02\x02"+
		"G\x11\x03\x02\x02\x02\n\x16\x1C #)6;F";
	public static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!YAJSParser.__ATN) {
			YAJSParser.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(YAJSParser._serializedATN));
		}

		return YAJSParser.__ATN;
	}

}

export class PathContext extends ParserRuleContext {
	public ROOT(): TerminalNode { return this.getToken(YAJSParser.ROOT, 0); }
	public pathStep(): PathStepContext[];
	public pathStep(i: number): PathStepContext;
	public pathStep(i?: number): PathStepContext | PathStepContext[] {
		if (i === undefined) {
			return this.getRuleContexts(PathStepContext);
		} else {
			return this.getRuleContext(i, PathStepContext);
		}
	}
	public actionProject(): ActionProjectContext | undefined {
		return this.tryGetRuleContext(0, ActionProjectContext);
	}
	public EOF(): TerminalNode | undefined { return this.tryGetToken(YAJSParser.EOF, 0); }
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return YAJSParser.RULE_path; }
	@Override
	public accept<Result>(visitor: YAJSVisitor<Result>): Result {
		if (visitor.visitPath) return visitor.visitPath(this);
		else return visitor.visitChildren(this);
	}
}


export class PathStepContext extends ParserRuleContext {
	public DOT(): TerminalNode[];
	public DOT(i: number): TerminalNode;
	public DOT(i?: number): TerminalNode | TerminalNode[] {
		if (i === undefined) {
			return this.getTokens(YAJSParser.DOT);
		} else {
			return this.getToken(YAJSParser.DOT, i);
		}
	}
	public actionField(): ActionFieldContext {
		return this.getRuleContext(0, ActionFieldContext);
	}
	public actionFilter(): ActionFilterContext | undefined {
		return this.tryGetRuleContext(0, ActionFilterContext);
	}
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return YAJSParser.RULE_pathStep; }
	@Override
	public accept<Result>(visitor: YAJSVisitor<Result>): Result {
		if (visitor.visitPathStep) return visitor.visitPathStep(this);
		else return visitor.visitChildren(this);
	}
}


export class ActionFieldContext extends ParserRuleContext {
	public _key: Token;
	public STAR(): TerminalNode | undefined { return this.tryGetToken(YAJSParser.STAR, 0); }
	public Identifier(): TerminalNode | undefined { return this.tryGetToken(YAJSParser.Identifier, 0); }
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return YAJSParser.RULE_actionField; }
	@Override
	public accept<Result>(visitor: YAJSVisitor<Result>): Result {
		if (visitor.visitActionField) return visitor.visitActionField(this);
		else return visitor.visitChildren(this);
	}
}


export class ActionFilterContext extends ParserRuleContext {
	public LSB(): TerminalNode { return this.getToken(YAJSParser.LSB, 0); }
	public filterExpression(): FilterExpressionContext {
		return this.getRuleContext(0, FilterExpressionContext);
	}
	public RSB(): TerminalNode { return this.getToken(YAJSParser.RSB, 0); }
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return YAJSParser.RULE_actionFilter; }
	@Override
	public accept<Result>(visitor: YAJSVisitor<Result>): Result {
		if (visitor.visitActionFilter) return visitor.visitActionFilter(this);
		else return visitor.visitChildren(this);
	}
}


export class ActionProjectContext extends ParserRuleContext {
	public LB(): TerminalNode { return this.getToken(YAJSParser.LB, 0); }
	public projectExpression(): ProjectExpressionContext {
		return this.getRuleContext(0, ProjectExpressionContext);
	}
	public RB(): TerminalNode { return this.getToken(YAJSParser.RB, 0); }
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return YAJSParser.RULE_actionProject; }
	@Override
	public accept<Result>(visitor: YAJSVisitor<Result>): Result {
		if (visitor.visitActionProject) return visitor.visitActionProject(this);
		else return visitor.visitChildren(this);
	}
}


export class ProjectExpressionContext extends ParserRuleContext {
	public Identifier(): TerminalNode[];
	public Identifier(i: number): TerminalNode;
	public Identifier(i?: number): TerminalNode | TerminalNode[] {
		if (i === undefined) {
			return this.getTokens(YAJSParser.Identifier);
		} else {
			return this.getToken(YAJSParser.Identifier, i);
		}
	}
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return YAJSParser.RULE_projectExpression; }
	@Override
	public accept<Result>(visitor: YAJSVisitor<Result>): Result {
		if (visitor.visitProjectExpression) return visitor.visitProjectExpression(this);
		else return visitor.visitChildren(this);
	}
}


export class FilterExpressionContext extends ParserRuleContext {
	public filterExpressionTerm(): FilterExpressionTermContext[];
	public filterExpressionTerm(i: number): FilterExpressionTermContext;
	public filterExpressionTerm(i?: number): FilterExpressionTermContext | FilterExpressionTermContext[] {
		if (i === undefined) {
			return this.getRuleContexts(FilterExpressionTermContext);
		} else {
			return this.getRuleContext(i, FilterExpressionTermContext);
		}
	}
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return YAJSParser.RULE_filterExpression; }
	@Override
	public accept<Result>(visitor: YAJSVisitor<Result>): Result {
		if (visitor.visitFilterExpression) return visitor.visitFilterExpression(this);
		else return visitor.visitChildren(this);
	}
}


export class FilterExpressionTermContext extends ParserRuleContext {
	public _key: Token;
	public filterExpressionTerm(): FilterExpressionTermContext | undefined {
		return this.tryGetRuleContext(0, FilterExpressionTermContext);
	}
	public AND(): TerminalNode | undefined { return this.tryGetToken(YAJSParser.AND, 0); }
	public OR(): TerminalNode | undefined { return this.tryGetToken(YAJSParser.OR, 0); }
	public NOT(): TerminalNode | undefined { return this.tryGetToken(YAJSParser.NOT, 0); }
	public LP(): TerminalNode | undefined { return this.tryGetToken(YAJSParser.LP, 0); }
	public filterExpression(): FilterExpressionContext | undefined {
		return this.tryGetRuleContext(0, FilterExpressionContext);
	}
	public RP(): TerminalNode | undefined { return this.tryGetToken(YAJSParser.RP, 0); }
	public Identifier(): TerminalNode | undefined { return this.tryGetToken(YAJSParser.Identifier, 0); }
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return YAJSParser.RULE_filterExpressionTerm; }
	@Override
	public accept<Result>(visitor: YAJSVisitor<Result>): Result {
		if (visitor.visitFilterExpressionTerm) return visitor.visitFilterExpressionTerm(this);
		else return visitor.visitChildren(this);
	}
}


