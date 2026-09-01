// Generated from src/main/lib/path/parser/YAJS.g4 by ANTLR 4.6-SNAPSHOT
// This file is ANTLR-generated (see `npm run antlr`) and not hand-maintained.
// It predates the antlr4ts typings' switch of `ruleIndex`/`serializedATN` from
// plain properties to accessors, so it is intentionally skipped by the type
// checker rather than hand-edited to match. Do not add new hand-written logic
// here - regenerate from src/main/lib/path/parser/YAJS.g4 instead.
// @ts-nocheck


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
	public static readonly REGEX=8;
	public static readonly FilterExpressionTerm=9;
	public static readonly ROOT=10;
	public static readonly DOT=11;
	public static readonly STAR=12;
	public static readonly AND=13;
	public static readonly OR=14;
	public static readonly NOT=15;
	public static readonly LP=16;
	public static readonly RP=17;
	public static readonly Whitespace=18;
	public static readonly modeNames: string[] = [
		"DEFAULT_MODE"
	];

	public static readonly ruleNames: string[] = [
		"LB", "RB", "LSB", "RSB", "LT", "GT", "Identifier", "REGEX", "FilterExpressionTerm", 
		"ROOT", "DOT", "STAR", "AND", "OR", "NOT", "LP", "RP", "Whitespace"
	];

	private static readonly _LITERAL_NAMES: (string | undefined)[] = [
		undefined, "'{'", "'}'", "'['", "']'", "'<'", "'>'", undefined, undefined, 
		undefined, "'$'", "'.'", "'*'", "'&&'", "'||'", "'!'", "'('", "')'"
	];
	private static readonly _SYMBOLIC_NAMES: (string | undefined)[] = [
		undefined, "LB", "RB", "LSB", "RSB", "LT", "GT", "Identifier", "REGEX", 
		"FilterExpressionTerm", "ROOT", "DOT", "STAR", "AND", "OR", "NOT", "LP", 
		"RP", "Whitespace"
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
			return this.REGEX_sempred(_localctx, predIndex);

		case 8:
			return this.FilterExpressionTerm_sempred(_localctx, predIndex);

		case 9:
			return this.ROOT_sempred(_localctx, predIndex);

		case 10:
			return this.DOT_sempred(_localctx, predIndex);

		case 11:
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
	private REGEX_sempred(_localctx: RuleContext, predIndex: number): boolean {
		switch (predIndex) {
		case 1:
			return  this.expression === true; ;
		}
		return true;
	}
	private FilterExpressionTerm_sempred(_localctx: RuleContext, predIndex: number): boolean {
		switch (predIndex) {
		case 2:
			return  this.expression === true; ;
		}
		return true;
	}
	private ROOT_sempred(_localctx: RuleContext, predIndex: number): boolean {
		switch (predIndex) {
		case 3:
			return  this.expression === false; ;
		}
		return true;
	}
	private DOT_sempred(_localctx: RuleContext, predIndex: number): boolean {
		switch (predIndex) {
		case 4:
			return  this.expression === false; ;
		}
		return true;
	}
	private STAR_sempred(_localctx: RuleContext, predIndex: number): boolean {
		switch (predIndex) {
		case 5:
			return  this.expression === false; ;
		}
		return true;
	}

	public static readonly _serializedATN: string =
		"\x03\uAF6F\u8320\u479D\uB75C\u4880\u1605\u191C\uAB37\x02\x14m\b\x01\x04"+
		"\x02\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04"+
		"\x07\t\x07\x04\b\t\b\x04\t\t\t\x04\n\t\n\x04\v\t\v\x04\f\t\f\x04\r\t\r"+
		"\x04\x0E\t\x0E\x04\x0F\t\x0F\x04\x10\t\x10\x04\x11\t\x11\x04\x12\t\x12"+
		"\x04\x13\t\x13\x03\x02\x03\x02\x03\x02\x03\x03\x03\x03\x03\x03\x03\x04"+
		"\x03\x04\x03\x04\x03\x05\x03\x05\x03\x05\x03\x06\x03\x06\x03\x06\x03\x07"+
		"\x03\x07\x03\x07\x03\b\x06\b;\n\b\r\b\x0E\b<\x03\b\x03\b\x03\t\x03\t\x07"+
		"\tC\n\t\f\t\x0E\tF\v\t\x03\t\x03\t\x03\t\x03\n\x06\nL\n\n\r\n\x0E\nM\x03"+
		"\n\x03\n\x03\v\x03\v\x03\v\x03\f\x03\f\x03\f\x03\r\x03\r\x03\r\x03\x0E"+
		"\x03\x0E\x03\x0E\x03\x0F\x03\x0F\x03\x0F\x03\x10\x03\x10\x03\x11\x03\x11"+
		"\x03\x12\x03\x12\x03\x13\x06\x13h\n\x13\r\x13\x0E\x13i\x03\x13\x03\x13"+
		"\x02\x02\x02\x14\x03\x02\x03\x05\x02\x04\x07\x02\x05\t\x02\x06\v\x02\x07"+
		"\r\x02\b\x0F\x02\t\x11\x02\n\x13\x02\v\x15\x02\f\x17\x02\r\x19\x02\x0E"+
		"\x1B\x02\x0F\x1D\x02\x10\x1F\x02\x11!\x02\x12#\x02\x13%\x02\x14\x03\x02"+
		"\x06\r\x02\v\v\"#&&((*,00>>@@]]__}\x7F\x05\x02\f\f\x0F\x0F11\v\x02\v\v"+
		"\"#((*+>>@@]]__}\x7F\x04\x02\v\v\"\"p\x02\x03\x03\x02\x02\x02\x02\x05"+
		"\x03\x02\x02\x02\x02\x07\x03\x02\x02\x02\x02\t\x03\x02\x02\x02\x02\v\x03"+
		"\x02\x02\x02\x02\r\x03\x02\x02\x02\x02\x0F\x03\x02\x02\x02\x02\x11\x03"+
		"\x02\x02\x02\x02\x13\x03\x02\x02\x02\x02\x15\x03\x02\x02\x02\x02\x17\x03"+
		"\x02\x02\x02\x02\x19\x03\x02\x02\x02\x02\x1B\x03\x02\x02\x02\x02\x1D\x03"+
		"\x02\x02\x02\x02\x1F\x03\x02\x02\x02\x02!\x03\x02\x02\x02\x02#\x03\x02"+
		"\x02\x02\x02%\x03\x02\x02\x02\x03\'\x03\x02\x02\x02\x05*\x03\x02\x02\x02"+
		"\x07-\x03\x02\x02\x02\t0\x03\x02\x02\x02\v3\x03\x02\x02\x02\r6\x03\x02"+
		"\x02\x02\x0F:\x03\x02\x02\x02\x11@\x03\x02\x02\x02\x13K\x03\x02\x02\x02"+
		"\x15Q\x03\x02\x02\x02\x17T\x03\x02\x02\x02\x19W\x03\x02\x02\x02\x1BZ\x03"+
		"\x02\x02\x02\x1D]\x03\x02\x02\x02\x1F`\x03\x02\x02\x02!b\x03\x02\x02\x02"+
		"#d\x03\x02\x02\x02%g\x03\x02\x02\x02\'(\x07}\x02\x02()\b\x02\x02\x02)"+
		"\x04\x03\x02\x02\x02*+\x07\x7F\x02\x02+,\b\x03\x03\x02,\x06\x03\x02\x02"+
		"\x02-.\x07]\x02\x02./\b\x04\x04\x02/\b\x03\x02\x02\x0201\x07_\x02\x02"+
		"12\b\x05\x05\x022\n\x03\x02\x02\x0234\x07>\x02\x0245\b\x06\x06\x025\f"+
		"\x03\x02\x02\x0267\x07@\x02\x0278\b\x07\x07\x028\x0E\x03\x02\x02\x029"+
		";\n\x02\x02\x02:9\x03\x02\x02\x02;<\x03\x02\x02\x02<:\x03\x02\x02\x02"+
		"<=\x03\x02\x02\x02=>\x03\x02\x02\x02>?\x06\b\x02\x02?\x10\x03\x02\x02"+
		"\x02@D\x071\x02\x02AC\n\x03\x02\x02BA\x03\x02\x02\x02CF\x03\x02\x02\x02"+
		"DB\x03\x02\x02\x02DE\x03\x02\x02\x02EG\x03\x02\x02\x02FD\x03\x02\x02\x02"+
		"GH\x071\x02\x02HI\x06\t\x03\x02I\x12\x03\x02\x02\x02JL\n\x04\x02\x02K"+
		"J\x03\x02\x02\x02LM\x03\x02\x02\x02MK\x03\x02\x02\x02MN\x03\x02\x02\x02"+
		"NO\x03\x02\x02\x02OP\x06\n\x04\x02P\x14\x03\x02\x02\x02QR\x07&\x02\x02"+
		"RS\x06\v\x05\x02S\x16\x03\x02\x02\x02TU\x070\x02\x02UV\x06\f\x06\x02V"+
		"\x18\x03\x02\x02\x02WX\x07,\x02\x02XY\x06\r\x07\x02Y\x1A\x03\x02\x02\x02"+
		"Z[\x07(\x02\x02[\\\x07(\x02\x02\\\x1C\x03\x02\x02\x02]^\x07~\x02\x02^"+
		"_\x07~\x02\x02_\x1E\x03\x02\x02\x02`a\x07#\x02\x02a \x03\x02\x02\x02b"+
		"c\x07*\x02\x02c\"\x03\x02\x02\x02de\x07+\x02\x02e$\x03\x02\x02\x02fh\t"+
		"\x05\x02\x02gf\x03\x02\x02\x02hi\x03\x02\x02\x02ig\x03\x02\x02\x02ij\x03"+
		"\x02\x02\x02jk\x03\x02\x02\x02kl\b\x13\b\x02l&\x03\x02\x02\x02\x07\x02"+
		"<DMi\t\x03\x02\x02\x03\x03\x03\x03\x04\x04\x03\x05\x05\x03\x06\x06\x03"+
		"\x07\x07\b\x02\x02";
	public static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!YAJSLexer.__ATN) {
			YAJSLexer.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(YAJSLexer._serializedATN));
		}

		return YAJSLexer.__ATN;
	}

}

