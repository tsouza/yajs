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
	public static readonly LT=5;
	public static readonly GT=6;
	public static readonly Identifier=7;
	public static readonly FilterExpressionTerm=8;
	public static readonly ROOT=9;
	public static readonly DOT=10;
	public static readonly STAR=11;
	public static readonly AND=12;
	public static readonly OR=13;
	public static readonly NOT=14;
	public static readonly LP=15;
	public static readonly RP=16;
	public static readonly Whitespace=17;
	public static readonly modeNames: string[] = [
		"DEFAULT_MODE"
	];

	public static readonly ruleNames: string[] = [
		"LB", "RB", "LSB", "RSB", "LT", "GT", "Identifier", "FilterExpressionTerm", 
		"ROOT", "DOT", "STAR", "AND", "OR", "NOT", "LP", "RP", "Whitespace"
	];

	private static readonly _LITERAL_NAMES: (string | undefined)[] = [
		undefined, "'{'", "'}'", "'['", "']'", "'<'", "'>'", undefined, undefined, 
		"'$'", "'.'", "'*'", "'&&'", "'||'", "'!'", "'('", "')'"
	];
	private static readonly _SYMBOLIC_NAMES: (string | undefined)[] = [
		undefined, "LB", "RB", "LSB", "RSB", "LT", "GT", "Identifier", "FilterExpressionTerm", 
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

		case 4:
			this.LT_action(_localctx, actionIndex);
			break;

		case 5:
			this.GT_action(_localctx, actionIndex);
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
	private LT_action(_localctx: RuleContext, actionIndex: number): void {
		switch (actionIndex) {
		case 4:
			 this.expression = true; 
			break;
		}
	}
	private GT_action(_localctx: RuleContext, actionIndex: number): void {
		switch (actionIndex) {
		case 5:
			 this.expression = false; 
			break;
		}
	}
	@Override
	public sempred(_localctx: RuleContext, ruleIndex: number, predIndex: number): boolean {
		switch (ruleIndex) {
		case 6:
			return this.Identifier_sempred(_localctx, predIndex);

		case 7:
			return this.FilterExpressionTerm_sempred(_localctx, predIndex);

		case 8:
			return this.ROOT_sempred(_localctx, predIndex);

		case 9:
			return this.DOT_sempred(_localctx, predIndex);

		case 10:
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
		"\x03\uAF6F\u8320\u479D\uB75C\u4880\u1605\u191C\uAB37\x02\x13a\b\x01\x04"+
		"\x02\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04"+
		"\x07\t\x07\x04\b\t\b\x04\t\t\t\x04\n\t\n\x04\v\t\v\x04\f\t\f\x04\r\t\r"+
		"\x04\x0E\t\x0E\x04\x0F\t\x0F\x04\x10\t\x10\x04\x11\t\x11\x04\x12\t\x12"+
		"\x03\x02\x03\x02\x03\x02\x03\x03\x03\x03\x03\x03\x03\x04\x03\x04\x03\x04"+
		"\x03\x05\x03\x05\x03\x05\x03\x06\x03\x06\x03\x06\x03\x07\x03\x07\x03\x07"+
		"\x03\b\x06\b9\n\b\r\b\x0E\b:\x03\b\x03\b\x03\t\x06\t@\n\t\r\t\x0E\tA\x03"+
		"\t\x03\t\x03\n\x03\n\x03\n\x03\v\x03\v\x03\v\x03\f\x03\f\x03\f\x03\r\x03"+
		"\r\x03\r\x03\x0E\x03\x0E\x03\x0E\x03\x0F\x03\x0F\x03\x10\x03\x10\x03\x11"+
		"\x03\x11\x03\x12\x06\x12\\\n\x12\r\x12\x0E\x12]\x03\x12\x03\x12\x02\x02"+
		"\x02\x13\x03\x02\x03\x05\x02\x04\x07\x02\x05\t\x02\x06\v\x02\x07\r\x02"+
		"\b\x0F\x02\t\x11\x02\n\x13\x02\v\x15\x02\f\x17\x02\r\x19\x02\x0E\x1B\x02"+
		"\x0F\x1D\x02\x10\x1F\x02\x11!\x02\x12#\x02\x13\x03\x02\x05\r\x02\v\v\""+
		"#&&((*,00>>@@]]__}\x7F\v\x02\v\v\"#((*+>>@@]]__}\x7F\x04\x02\v\v\"\"c"+
		"\x02\x03\x03\x02\x02\x02\x02\x05\x03\x02\x02\x02\x02\x07\x03\x02\x02\x02"+
		"\x02\t\x03\x02\x02\x02\x02\v\x03\x02\x02\x02\x02\r\x03\x02\x02\x02\x02"+
		"\x0F\x03\x02\x02\x02\x02\x11\x03\x02\x02\x02\x02\x13\x03\x02\x02\x02\x02"+
		"\x15\x03\x02\x02\x02\x02\x17\x03\x02\x02\x02\x02\x19\x03\x02\x02\x02\x02"+
		"\x1B\x03\x02\x02\x02\x02\x1D\x03\x02\x02\x02\x02\x1F\x03\x02\x02\x02\x02"+
		"!\x03\x02\x02\x02\x02#\x03\x02\x02\x02\x03%\x03\x02\x02\x02\x05(\x03\x02"+
		"\x02\x02\x07+\x03\x02\x02\x02\t.\x03\x02\x02\x02\v1\x03\x02\x02\x02\r"+
		"4\x03\x02\x02\x02\x0F8\x03\x02\x02\x02\x11?\x03\x02\x02\x02\x13E\x03\x02"+
		"\x02\x02\x15H\x03\x02\x02\x02\x17K\x03\x02\x02\x02\x19N\x03\x02\x02\x02"+
		"\x1BQ\x03\x02\x02\x02\x1DT\x03\x02\x02\x02\x1FV\x03\x02\x02\x02!X\x03"+
		"\x02\x02\x02#[\x03\x02\x02\x02%&\x07}\x02\x02&\'\b\x02\x02\x02\'\x04\x03"+
		"\x02\x02\x02()\x07\x7F\x02\x02)*\b\x03\x03\x02*\x06\x03\x02\x02\x02+,"+
		"\x07]\x02\x02,-\b\x04\x04\x02-\b\x03\x02\x02\x02./\x07_\x02\x02/0\b\x05"+
		"\x05\x020\n\x03\x02\x02\x0212\x07>\x02\x0223\b\x06\x06\x023\f\x03\x02"+
		"\x02\x0245\x07@\x02\x0256\b\x07\x07\x026\x0E\x03\x02\x02\x0279\n\x02\x02"+
		"\x0287\x03\x02\x02\x029:\x03\x02\x02\x02:8\x03\x02\x02\x02:;\x03\x02\x02"+
		"\x02;<\x03\x02\x02\x02<=\x06\b\x02\x02=\x10\x03\x02\x02\x02>@\n\x03\x02"+
		"\x02?>\x03\x02\x02\x02@A\x03\x02\x02\x02A?\x03\x02\x02\x02AB\x03\x02\x02"+
		"\x02BC\x03\x02\x02\x02CD\x06\t\x03\x02D\x12\x03\x02\x02\x02EF\x07&\x02"+
		"\x02FG\x06\n\x04\x02G\x14\x03\x02\x02\x02HI\x070\x02\x02IJ\x06\v\x05\x02"+
		"J\x16\x03\x02\x02\x02KL\x07,\x02\x02LM\x06\f\x06\x02M\x18\x03\x02\x02"+
		"\x02NO\x07(\x02\x02OP\x07(\x02\x02P\x1A\x03\x02\x02\x02QR\x07~\x02\x02"+
		"RS\x07~\x02\x02S\x1C\x03\x02\x02\x02TU\x07#\x02\x02U\x1E\x03\x02\x02\x02"+
		"VW\x07*\x02\x02W \x03\x02\x02\x02XY\x07+\x02\x02Y\"\x03\x02\x02\x02Z\\"+
		"\t\x04\x02\x02[Z\x03\x02\x02\x02\\]\x03\x02\x02\x02][\x03\x02\x02\x02"+
		"]^\x03\x02\x02\x02^_\x03\x02\x02\x02_`\b\x12\b\x02`$\x03\x02\x02\x02\x06"+
		"\x02:A]\t\x03\x02\x02\x03\x03\x03\x03\x04\x04\x03\x05\x05\x03\x06\x06"+
		"\x03\x07\x07\b\x02\x02";
	public static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!YAJSLexer.__ATN) {
			YAJSLexer.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(YAJSLexer._serializedATN));
		}

		return YAJSLexer.__ATN;
	}

}

