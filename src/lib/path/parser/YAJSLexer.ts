// Generated from src/lib/path/parser/YAJS.g4 by ANTLR 4.6-SNAPSHOT


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
	public static readonly modeNames: string[] = [
		"DEFAULT_MODE"
	];

	public static readonly ruleNames: string[] = [
		"Identifier", "ROOT", "DOT", "AND", "OR", "NOT", "LP", "RP", "LB", "RB", 
		"LSB", "RSB", "STAR", "Whitespace"
	];

	private static readonly _LITERAL_NAMES: (string | undefined)[] = [
		undefined, undefined, "'$'", "'.'", "'&&'", "'||'", "'!'", "'('", "')'", 
		"'{'", "'}'", "'['", "']'", "'*'"
	];
	private static readonly _SYMBOLIC_NAMES: (string | undefined)[] = [
		undefined, "Identifier", "ROOT", "DOT", "AND", "OR", "NOT", "LP", "RP", 
		"LB", "RB", "LSB", "RSB", "STAR", "Whitespace"
	];
	public static readonly VOCABULARY: Vocabulary = new VocabularyImpl(YAJSLexer._LITERAL_NAMES, YAJSLexer._SYMBOLIC_NAMES, []);

	@Override
	@NotNull
	public get vocabulary(): Vocabulary {
		return YAJSLexer.VOCABULARY;
	}


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

	public static readonly _serializedATN: string =
		"\x03\uAF6F\u8320\u479D\uB75C\u4880\u1605\u191C\uAB37\x02\x10E\b\x01\x04"+
		"\x02\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04"+
		"\x07\t\x07\x04\b\t\b\x04\t\t\t\x04\n\t\n\x04\v\t\v\x04\f\t\f\x04\r\t\r"+
		"\x04\x0E\t\x0E\x04\x0F\t\x0F\x03\x02\x06\x02!\n\x02\r\x02\x0E\x02\"\x03"+
		"\x03\x03\x03\x03\x04\x03\x04\x03\x05\x03\x05\x03\x05\x03\x06\x03\x06\x03"+
		"\x06\x03\x07\x03\x07\x03\b\x03\b\x03\t\x03\t\x03\n\x03\n\x03\v\x03\v\x03"+
		"\f\x03\f\x03\r\x03\r\x03\x0E\x03\x0E\x03\x0F\x06\x0F@\n\x0F\r\x0F\x0E"+
		"\x0FA\x03\x0F\x03\x0F\x02\x02\x02\x10\x03\x02\x03\x05\x02\x04\x07\x02"+
		"\x05\t\x02\x06\v\x02\x07\r\x02\b\x0F\x02\t\x11\x02\n\x13\x02\v\x15\x02"+
		"\f\x17\x02\r\x19\x02\x0E\x1B\x02\x0F\x1D\x02\x10\x03\x02\x04\v\x02\v\v"+
		"\"#&&((*,00]]__}\x7F\x04\x02\v\v\"\"F\x02\x03\x03\x02\x02\x02\x02\x05"+
		"\x03\x02\x02\x02\x02\x07\x03\x02\x02\x02\x02\t\x03\x02\x02\x02\x02\v\x03"+
		"\x02\x02\x02\x02\r\x03\x02\x02\x02\x02\x0F\x03\x02\x02\x02\x02\x11\x03"+
		"\x02\x02\x02\x02\x13\x03\x02\x02\x02\x02\x15\x03\x02\x02\x02\x02\x17\x03"+
		"\x02\x02\x02\x02\x19\x03\x02\x02\x02\x02\x1B\x03\x02\x02\x02\x02\x1D\x03"+
		"\x02\x02\x02\x03 \x03\x02\x02\x02\x05$\x03\x02\x02\x02\x07&\x03\x02\x02"+
		"\x02\t(\x03\x02\x02\x02\v+\x03\x02\x02\x02\r.\x03\x02\x02\x02\x0F0\x03"+
		"\x02\x02\x02\x112\x03\x02\x02\x02\x134\x03\x02\x02\x02\x156\x03\x02\x02"+
		"\x02\x178\x03\x02\x02\x02\x19:\x03\x02\x02\x02\x1B<\x03\x02\x02\x02\x1D"+
		"?\x03\x02\x02\x02\x1F!\n\x02\x02\x02 \x1F\x03\x02\x02\x02!\"\x03\x02\x02"+
		"\x02\" \x03\x02\x02\x02\"#\x03\x02\x02\x02#\x04\x03\x02\x02\x02$%\x07"+
		"&\x02\x02%\x06\x03\x02\x02\x02&\'\x070\x02\x02\'\b\x03\x02\x02\x02()\x07"+
		"(\x02\x02)*\x07(\x02\x02*\n\x03\x02\x02\x02+,\x07~\x02\x02,-\x07~\x02"+
		"\x02-\f\x03\x02\x02\x02./\x07#\x02\x02/\x0E\x03\x02\x02\x0201\x07*\x02"+
		"\x021\x10\x03\x02\x02\x0223\x07+\x02\x023\x12\x03\x02\x02\x0245\x07}\x02"+
		"\x025\x14\x03\x02\x02\x0267\x07\x7F\x02\x027\x16\x03\x02\x02\x0289\x07"+
		"]\x02\x029\x18\x03\x02\x02\x02:;\x07_\x02\x02;\x1A\x03\x02\x02\x02<=\x07"+
		",\x02\x02=\x1C\x03\x02\x02\x02>@\t\x03\x02\x02?>\x03\x02\x02\x02@A\x03"+
		"\x02\x02\x02A?\x03\x02\x02\x02AB\x03\x02\x02\x02BC\x03\x02\x02\x02CD\b"+
		"\x0F\x02\x02D\x1E\x03\x02\x02\x02\x05\x02\"A\x03\b\x02\x02";
	public static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!YAJSLexer.__ATN) {
			YAJSLexer.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(YAJSLexer._serializedATN));
		}

		return YAJSLexer.__ATN;
	}

}

