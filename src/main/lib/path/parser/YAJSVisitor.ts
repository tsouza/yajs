// Generated from src/main/lib/path/parser/YAJS.g4 by ANTLR 4.6-SNAPSHOT


import { ParseTreeVisitor } from 'antlr4ts/tree/ParseTreeVisitor';

import { PathContext } from './YAJSParser';
import { PathStepContext } from './YAJSParser';
import { ActionFieldContext } from './YAJSParser';
import { ActionFilterContext } from './YAJSParser';
import { PathLeafContext } from './YAJSParser';
import { ActionProjectContext } from './YAJSParser';
import { ActionDropKeysContext } from './YAJSParser';
import { FilterExpressionContext } from './YAJSParser';
import { FilterExpressionTermContext } from './YAJSParser';


/**
 * This interface defines a complete generic visitor for a parse tree produced
 * by `YAJSParser`.
 *
 * @param <Result> The return type of the visit operation. Use `void` for
 * operations with no return type.
 */
export interface YAJSVisitor<Result> extends ParseTreeVisitor<Result> {
	/**
	 * Visit a parse tree produced by `YAJSParser.path`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitPath?: (ctx: PathContext) => Result;

	/**
	 * Visit a parse tree produced by `YAJSParser.pathStep`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitPathStep?: (ctx: PathStepContext) => Result;

	/**
	 * Visit a parse tree produced by `YAJSParser.actionField`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitActionField?: (ctx: ActionFieldContext) => Result;

	/**
	 * Visit a parse tree produced by `YAJSParser.actionFilter`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitActionFilter?: (ctx: ActionFilterContext) => Result;

	/**
	 * Visit a parse tree produced by `YAJSParser.pathLeaf`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitPathLeaf?: (ctx: PathLeafContext) => Result;

	/**
	 * Visit a parse tree produced by `YAJSParser.actionProject`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitActionProject?: (ctx: ActionProjectContext) => Result;

	/**
	 * Visit a parse tree produced by `YAJSParser.actionDropKeys`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitActionDropKeys?: (ctx: ActionDropKeysContext) => Result;

	/**
	 * Visit a parse tree produced by `YAJSParser.filterExpression`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitFilterExpression?: (ctx: FilterExpressionContext) => Result;

	/**
	 * Visit a parse tree produced by `YAJSParser.filterExpressionTerm`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitFilterExpressionTerm?: (ctx: FilterExpressionTermContext) => Result;
}

