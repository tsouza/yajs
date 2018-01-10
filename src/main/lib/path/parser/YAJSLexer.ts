// Generated from src/main/lib/path/parser/YAJS.g4 by ANTLR 4.6-SNAPSHOT


import { ATN } from 'antlr4ts/atn/ATN';
import { ATNDeserializer } from 'antlr4ts/atn/ATNDeserializer';
import { CharStream } from 'antlr4ts/CharStream';
import { Lexer } from 'antlr4ts/Lexer';
import { LexerATNSimulator } from 'antlr4ts/atn/LexerATNSimulator';
import { NotNull } from 'antlr4ts/Decorators';
import { Override } from 'antlr4ts/Decorators';
import { RuleContext } from 'antlr4ts/RuleContext';
import { Vocabulary } from 'antlr4ts/Vocabulary';
import { VocabularyImpl } from 'antlr4ts/VocabularyImpl';

import * as Utils from 'antlr4ts/misc/Utils';


export class YAJSLexer extends Lexer {
	public static readonly LB=1;
	public static readonly RB=2;
	public static readonly LSB=3;
	public static readonly RSB=4;
	public static readonly Identifier=5;
	public static readonly FilterExpressionTerm=6;
	public static readonly ROOT=7;
	public static readonly DOT=8;
	public static readonly STAR=9;
	public static readonly AND=10;
	public static readonly OR=11;
	public static readonly NOT=12;
	public static readonly LP=13;
	public static readonly RP=14;
	public static readonly Whitespace=15;
	public static readonly modeNames: string[] = [
		"DEFAULT_MODE"
	];

	public static readonly ruleNames: string[] = [
		"LB", "RB", "LSB", "RSB", "Identifier", "FilterExpressionTerm", "ROOT", 
		"DOT", "STAR", "AND", "OR", "NOT", "LP", "RP", "Whitespace"
	];

	private static readonly _LITERAL_NAMES: (string | undefined)[] = [
		undefined, "'{'", "'}'", "'['", "']'", undefined, undefined, "'$'", "'.'", 
		"'*'", "'&&'", "'||'", "'!'", "'('", "')'"
	];
	private static readonly _SYMBOLIC_NAMES: (string | undefined)[] = [
		undefined, "LB", "RB", "LSB", "RSB", "Identifier", "FilterExpressionTerm", 
		"ROOT", "DOT", "STAR", "AND", "OR", "NOT", "LP", "RP", "Whitespace"
	];
	public static readonly VOCABULARY: Vocabulary = new VocabularyImpl(YAJSLexer._LITERAL_NAMES, YAJSLexer._SYMBOLIC_NAMES, []);

	@Override
	@NotNull
	public get vocabulary(): Vocabulary {
		return YAJSLexer.VOCABULARY;
	}


	    private expression = false;


	constructor(input: CharStream) {
		super(input);
		this._interp = new LexerATNSimulator(YAJSLexer._ATN, this);
	}

	@Override
	public get grammarFileName(): string { return "YAJS.g4"; }

	@Override
	public get ruleNames(): string[] { return YAJSLexer.ruleNames; }

	@Override
	public get serializedATN(): string { return YAJSLexer._serializedATN; }

	@Override
	public get modeNames(): string[] { return YAJSLexer.modeNames; }

	@Override
	action(_localctx: RuleContext, ruleIndex: number, actionIndex: number): void {
		switch (ruleIndex) {
		case 0:
			this.LB_action(_localctx, actionIndex);
			break;

		case 1:
			this.RB_action(_localctx, actionIndex);
			break;

		case 2:
			this.LSB_action(_localctx, actionIndex);
			break;

		case 3:
			this.RSB_action(_localctx, actionIndex);
			break;
		}
	}
	private LB_action(_localctx: RuleContext, actionIndex: number): void {
		switch (actionIndex) {
		case 0:
			 this.expression = true;  
			break;
		}
	}
	private RB_action(_localctx: RuleContext, actionIndex: number): void {
		switch (actionIndex) {
		case 1:
			 this.expression = false; 
			break;
		}
	}
	private LSB_action(_localctx: RuleContext, actionIndex: number): void {
		switch (actionIndex) {
		case 2:
			 this.expression = true;  
			break;
		}
	}
	private RSB_action(_localctx: RuleContext, actionIndex: number): void {
		switch (actionIndex) {
		case 3:
			 this.expression = false; 
			break;
		}
	}
	@Override
	public sempred(_localctx: RuleContext, ruleIndex: number, predIndex: number): boolean {
		switch (ruleIndex) {
		case 4:
			return this.Identifier_sempred(_localctx, predIndex);

		case 5:
			return this.FilterExpressionTerm_sempred(_localctx, predIndex);

		case 6:
			return this.ROOT_sempred(_localctx, predIndex);

		case 7:
			return this.DOT_sempred(_localctx, predIndex);

		case 8:
			return this.STAR_sempred(_localctx, predIndex);
		}
		return true;
	}
	private Identifier_sempred(_localctx: RuleContext, predIndex: number): boolean {
		switch (predIndex) {
		case 0:
			return  this.expression === false; ;
		}
		return true;
	}
	private FilterExpressionTerm_sempred(_localctx: RuleContext, predIndex: number): boolean {
		switch (predIndex) {
		case 1:
			return  this.expression === true; ;
		}
		return true;
	}
	private ROOT_sempred(_localctx: RuleContext, predIndex: number): boolean {
		switch (predIndex) {
		case 2:
			return  this.expression === false; ;
		}
		return true;
	}
	private DOT_sempred(_localctx: RuleContext, predIndex: number): boolean {
		switch (predIndex) {
		case 3:
			return  this.expression === false; ;
		}
		return true;
	}
	private STAR_sempred(_localctx: RuleContext, predIndex: number): boolean {
		switch (predIndex) {
		case 4:
			return  this.expression === false; ;
		}
		return true;
	}

	public static readonly _serializedATN: string =
		"\x03\uAF6F\u8320\u479D\uB75C\u4880\u1605\u191C\uAB37\x02\x11W\b\x01\x04"+
		"\x02\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04"+
		"\x07\t\x07\x04\b\t\b\x04\t\t\t\x04\n\t\n\x04\v\t\v\x04\f\t\f\x04\r\t\r"+
		"\x04\x0E\t\x0E\x04\x0F\t\x0F\x04\x10\t\x10\x03\x02\x03\x02\x03\x02\x03"+
		"\x03\x03\x03\x03\x03\x03\x04\x03\x04\x03\x04\x03\x05\x03\x05\x03\x05\x03"+
		"\x06\x06\x06/\n\x06\r\x06\x0E\x060\x03\x06\x03\x06\x03\x07\x06\x076\n"+
		"\x07\r\x07\x0E\x077\x03\x07\x03\x07\x03\b\x03\b\x03\b\x03\t\x03\t\x03"+
		"\t\x03\n\x03\n\x03\n\x03\v\x03\v\x03\v\x03\f\x03\f\x03\f\x03\r\x03\r\x03"+
		"\x0E\x03\x0E\x03\x0F\x03\x0F\x03\x10\x06\x10R\n\x10\r\x10\x0E\x10S\x03"+
		"\x10\x03\x10\x02\x02\x02\x11\x03\x02\x03\x05\x02\x04\x07\x02\x05\t\x02"+
		"\x06\v\x02\x07\r\x02\b\x0F\x02\t\x11\x02\n\x13\x02\v\x15\x02\f\x17\x02"+
		"\r\x19\x02\x0E\x1B\x02\x0F\x1D\x02\x10\x1F\x02\x11\x03\x02\x05\v\x02\v"+
		"\v\"#&&((*,00]]__}\x7F\t\x02\v\v\"#((*+]]__}\x7F\x04\x02\v\v\"\"Y\x02"+
		"\x03\x03\x02\x02\x02\x02\x05\x03\x02\x02\x02\x02\x07\x03\x02\x02\x02\x02"+
		"\t\x03\x02\x02\x02\x02\v\x03\x02\x02\x02\x02\r\x03\x02\x02\x02\x02\x0F"+
		"\x03\x02\x02\x02\x02\x11\x03\x02\x02\x02\x02\x13\x03\x02\x02\x02\x02\x15"+
		"\x03\x02\x02\x02\x02\x17\x03\x02\x02\x02\x02\x19\x03\x02\x02\x02\x02\x1B"+
		"\x03\x02\x02\x02\x02\x1D\x03\x02\x02\x02\x02\x1F\x03\x02\x02\x02\x03!"+
		"\x03\x02\x02\x02\x05$\x03\x02\x02\x02\x07\'\x03\x02\x02\x02\t*\x03\x02"+
		"\x02\x02\v.\x03\x02\x02\x02\r5\x03\x02\x02\x02\x0F;\x03\x02\x02\x02\x11"+
		">\x03\x02\x02\x02\x13A\x03\x02\x02\x02\x15D\x03\x02\x02\x02\x17G\x03\x02"+
		"\x02\x02\x19J\x03\x02\x02\x02\x1BL\x03\x02\x02\x02\x1DN\x03\x02\x02\x02"+
		"\x1FQ\x03\x02\x02\x02!\"\x07}\x02\x02\"#\b\x02\x02\x02#\x04\x03\x02\x02"+
		"\x02$%\x07\x7F\x02\x02%&\b\x03\x03\x02&\x06\x03\x02\x02\x02\'(\x07]\x02"+
		"\x02()\b\x04\x04\x02)\b\x03\x02\x02\x02*+\x07_\x02\x02+,\b\x05\x05\x02"+
		",\n\x03\x02\x02\x02-/\n\x02\x02\x02.-\x03\x02\x02\x02/0\x03\x02\x02\x02"+
		"0.\x03\x02\x02\x0201\x03\x02\x02\x0212\x03\x02\x02\x0223\x06\x06\x02\x02"+
		"3\f\x03\x02\x02\x0246\n\x03\x02\x0254\x03\x02\x02\x0267\x03\x02\x02\x02"+
		"75\x03\x02\x02\x0278\x03\x02\x02\x0289\x03\x02\x02\x029:\x06\x07\x03\x02"+
		":\x0E\x03\x02\x02\x02;<\x07&\x02\x02<=\x06\b\x04\x02=\x10\x03\x02\x02"+
		"\x02>?\x070\x02\x02?@\x06\t\x05\x02@\x12\x03\x02\x02\x02AB\x07,\x02\x02"+
		"BC\x06\n\x06\x02C\x14\x03\x02\x02\x02DE\x07(\x02\x02EF\x07(\x02\x02F\x16"+
		"\x03\x02\x02\x02GH\x07~\x02\x02HI\x07~\x02\x02I\x18\x03\x02\x02\x02JK"+
		"\x07#\x02\x02K\x1A\x03\x02\x02\x02LM\x07*\x02\x02M\x1C\x03\x02\x02\x02"+
		"NO\x07+\x02\x02O\x1E\x03\x02\x02\x02PR\t\x04\x02\x02QP\x03\x02\x02\x02"+
		"RS\x03\x02\x02\x02SQ\x03\x02\x02\x02ST\x03\x02\x02\x02TU\x03\x02\x02\x02"+
		"UV\b\x10\x06\x02V \x03\x02\x02\x02\x06\x0207S\x07\x03\x02\x02\x03\x03"+
		"\x03\x03\x04\x04\x03\x05\x05\b\x02\x02";
	public static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!YAJSLexer.__ATN) {
			YAJSLexer.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(YAJSLexer._serializedATN));
		}

		return YAJSLexer.__ATN;
	}

}

