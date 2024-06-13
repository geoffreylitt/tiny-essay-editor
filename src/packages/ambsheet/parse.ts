import * as ohm from 'ohm-js';
import { Position, RawValue } from './datatype';

export type AmbLiteralNode = {
  type: 'amb';
  pos: Position;
  parts: AmbNodePart[];
};

export interface AmbRangePart {
  type: 'range';
  from: number;
  to: number;
  step: number;
}
export interface AmbRepeatPart {
  type: 'repeat';
  value: RawValue;
  numRepeats: number;
}
export type AmbNodePart = AmbRepeatPart | AmbRangePart;

export interface AmbifyNode {
  type: 'ambify';
  pos: Position;
  range: RangeNode;
}

export interface DeambifyNode {
  type: 'deambify';
  pos: Position;
  ref: PositionalCellRefNode;
}

export interface NormalDistributionNode {
  type: 'normal';
  pos: Position;
  mean: number;
  stdev: number;
  samples: number;
}

export type AmbNode =
  | AmbLiteralNode
  | AmbifyNode
  | DeambifyNode
  | NormalDistributionNode;

type AddressingMode = 'relative' | 'absolute';
export type PositionalCellRefNode = {
  type: 'positionalCellRef';
  rowMode: AddressingMode;
  colMode: AddressingMode;
} & Position;
export type NamedCellRefNode = {
  type: 'namedCellRef';
  name: string;
};

interface RangeNode {
  type: 'range';
  topLeft: PositionalCellRefNode;
  bottomRight: PositionalCellRefNode;
}

export type Node =
  | AmbNode
  | PositionalCellRefNode
  | NamedCellRefNode
  | RangeNode
  | { type: 'const'; value: number }
  | { type: 'if'; cond: Node; then: Node; else: Node }
  | { type: 'call'; funcName: string; args: Node[] }
  | {
      type: 'named';
      name: string;
      node: Node;
      pos: Position;
    };

const grammarSource = String.raw`
  AmbSheets {
    Formula
      = ident? "=" ambify "(" CellRange ")"                     -- ambify
      | ident? "=" deambify "(" cellRef ")"                     -- deambify
      | ident? "=" normal "(" number "," number "," number ")"  -- normal
      | ident? "=" Exp                                          -- expression
      | ident? "=" Amb                                          -- amb
      | Amb

    Exp = RelExp

    RelExp
      = AddExp "="  AddExp  -- eq
      | AddExp "<>" AddExp  -- neq
      | AddExp ">=" AddExp  -- ge
      | AddExp ">"  AddExp  -- gt
      | AddExp "<=" AddExp  -- le
      | AddExp "<"  AddExp  -- lt
      | AddExp

    AddExp
      = AddExp "+" MulExp  -- plus
      | AddExp "-" MulExp  -- minus
      | MulExp

    MulExp
      = MulExp "*" CallExp  -- times
      | MulExp "/" CallExp  -- div
      | CallExp

    CallExp
      = if "(" Exp "," Exp "," Exp ")"  -- if
      | ident "(" ListOf<Exp, ","> ")"  -- call
      | UnExp

    UnExp
      = "-" PriExp  -- neg
      | PriExp

    PriExp
      = "(" Exp ")"     -- paren
      | Literal         -- const
      | CellRange
      | cellRef

    Amb
      = "{" ListOf<AmbPart, ","> "}"

    AmbPart
      = number to number by number  -- rangeWithStep
      | number to number            -- rangeAutoStep
      | Literal x digit+            -- repeated
      | Literal                     -- single

    Literal
      = number
      | boolean
      | string

    number  (a number)
      = "-" unsignedNumber   -- negative
      | "+"? unsignedNumber  -- positive

    unsignedNumber
      = digit* "." digit+  -- fract
      | digit+             -- whole

    boolean
      = true   -- true
      | false  -- false

    string  (a string literal)
      = "\"" (~"\"" ~"\n" any)* "\""

    CellRange
      = cellRef ":" cellRef

    cellRef
      = "$"? letter "$"? digit+  -- positional
      | ident                    -- named

    ident  (an identifier)
      = ~keyword letter alnum*

    // keywords
    keyword = ambify | by | deambify | false | if | normal | to | true | x
    ambify = caseInsensitive<"ambify"> ~alnum
    deambify = caseInsensitive<"deambify"> ~alnum
    by = caseInsensitive<"by"> ~alnum
    false = caseInsensitive<"false"> ~alnum
    if = caseInsensitive<"if"> ~alnum
    normal = caseInsensitive<"normal"> ~alnum
    to = caseInsensitive<"to"> ~alnum
    true = caseInsensitive<"true"> ~alnum
    x = caseInsensitive<"x"> ~letter
  }
`;

const g = ohm.grammar(grammarSource);

export const isFormula = (input: string) => {
  if (!input) return false;
  return g.match(input).succeeded();
};

// this is hacky, but it's convenient...
let pos = { row: 0, col: 0 };

function withName(name: ohm.Node, pos: Position, ast: Node) {
  return name.sourceString === ''
    ? ast
    : { type: 'named', name: name.sourceString, node: ast, pos };
}

const semantics = g.createSemantics().addOperation('toAst', {
  Formula_ambify(name, _eq, _ambify, _lparen, range, _rparen) {
    return withName(name, pos, {
      type: 'ambify',
      pos,
      range: range.toAst(),
    });
  },

  Formula_deambify(name, _eq, _ambify, _lparen, ref, _rparen) {
    return withName(name, pos, {
      type: 'deambify',
      pos,
      ref: ref.toAst(),
    });
  },

  Formula_normal(
    name,
    _eq,
    _normal,
    _lparen,
    mean,
    _c1,
    stdev,
    _c2,
    samples,
    _rparen
  ) {
    return withName(name, pos, {
      type: 'normal',
      mean: parseFloat(mean.sourceString),
      stdev: parseFloat(stdev.sourceString),
      samples: parseInt(samples.sourceString),
      pos,
    });
  },

  Formula_expression(name, _eq, exp) {
    return withName(name, pos, exp.toAst());
  },

  Formula_amb(name, _eq, amb) {
    return withName(name, pos, amb.toAst());
  },

  RelExp_eq(left, _op, right) {
    return {
      type: 'call',
      funcName: '=',
      args: [left.toAst(), right.toAst()],
    };
  },
  RelExp_neq(left, _op, right) {
    return {
      type: 'call',
      funcName: '<>',
      args: [left.toAst(), right.toAst()],
    };
  },
  RelExp_ge(left, _op, right) {
    return {
      type: 'call',
      funcName: '>=',
      args: [left.toAst(), right.toAst()],
    };
  },
  RelExp_gt(left, _op, right) {
    return {
      type: 'call',
      funcName: '>',
      args: [left.toAst(), right.toAst()],
    };
  },
  RelExp_le(left, _op, right) {
    return {
      type: 'call',
      funcName: '<=',
      args: [left.toAst(), right.toAst()],
    };
  },
  RelExp_lt(left, _op, right) {
    return {
      type: 'call',
      funcName: '<',
      args: [left.toAst(), right.toAst()],
    };
  },
  AddExp_plus(left, _op, right) {
    return {
      type: 'call',
      funcName: '+',
      args: [left.toAst(), right.toAst()],
    };
  },
  AddExp_minus(left, _op, right) {
    return {
      type: 'call',
      funcName: '-',
      args: [left.toAst(), right.toAst()],
    };
  },
  MulExp_times(left, _op, right) {
    return {
      type: 'call',
      funcName: '*',
      args: [left.toAst(), right.toAst()],
    };
  },
  MulExp_div(left, _op, right) {
    return {
      type: 'call',
      funcName: '/',
      args: [left.toAst(), right.toAst()],
    };
  },
  CallExp_if(_if, _lparen, cond, _c1, thenExp, _c2, elseExp, _rparen) {
    return {
      type: 'if',
      cond: cond.toAst(),
      then: thenExp.toAst(),
      else: elseExp.toAst(),
    };
  },
  CallExp_call(fnName, _lparen, args, _rparen) {
    return {
      type: 'call',
      funcName: fnName.sourceString.toLowerCase(),
      args: args.toAst(),
    };
  },
  UnExp_neg(_op, exp) {
    return {
      type: 'call',
      funcName: '-',
      args: [{ type: 'const', value: 0 }, exp.toAst()],
    };
  },
  PriExp_paren(_lparen, exp, _rparen) {
    return exp.toAst();
  },
  PriExp_const(v) {
    return { type: 'const', value: v.toAst() };
  },
  Amb(_lbrace, list, _rbrace) {
    return {
      type: 'amb',
      pos,
      parts: list.toAst(),
    };
  },
  AmbPart_repeated(exp, _x, n) {
    return {
      type: 'repeat',
      value: exp.toAst(),
      numRepeats: parseInt(n.sourceString),
    };
  },
  AmbPart_single(exp) {
    return { type: 'repeat', value: exp.toAst(), numRepeats: 1 };
  },
  AmbPart_rangeAutoStep(fromNode, _sep, toNode) {
    const from = parseFloat(fromNode.sourceString);
    const to = parseFloat(toNode.sourceString);
    return { type: 'range', from, to, step: from < to ? 1 : -1 };
  },
  AmbPart_rangeWithStep(from, _to, to, _by, step) {
    return {
      type: 'range',
      from: parseFloat(from.sourceString),
      to: parseFloat(to.sourceString),
      step: parseFloat(step.sourceString),
    };
  },
  Literal(v) {
    return v.toAst();
  },
  number(n) {
    return parseFloat(n.sourceString);
  },
  boolean_true(_t) {
    return true;
  },
  boolean_false(_f) {
    return false;
  },
  string(_oq, csNode, _cq) {
    const cs: string[] = csNode.toAst();
    const chars: string[] = [];
    let idx = 0;
    while (idx < cs.length) {
      let c = cs[idx++];
      if (c === '\\' && idx < cs.length) {
        c = cs[idx++];
        switch (c) {
          case 'n':
            c = '\n';
            break;
          case 't':
            c = '\t';
            break;
          default:
            idx--;
        }
      }
      chars.push(c);
    }
    return chars.join('');
  },
  CellRange(topLeft, _colon, bottomRight) {
    return {
      type: 'range',
      topLeft: topLeft.toAst(),
      bottomRight: bottomRight.toAst(),
    };
  },
  cellRef_positional(cDollar, c, rDollar, r) {
    const [rowMode, colMode] = [rDollar, cDollar].map((dollar) =>
      dollar.sourceString === '$' ? 'absolute' : 'relative'
    );
    return {
      type: 'positionalCellRef',
      rowMode,
      row:
        parseInt(r.sourceString) - 1 - (rowMode === 'absolute' ? 0 : pos.row),
      colMode,
      col:
        c.sourceString.toUpperCase().charCodeAt(0) -
        'A'.charCodeAt(0) -
        (colMode === 'absolute' ? 0 : pos.col),
    };
  },
  cellRef_named(name) {
    return {
      type: 'namedCellRef',
      name: name.sourceString,
    };
  },
  NonemptyListOf(x, _sep, xs) {
    return [x.toAst()].concat(xs.toAst());
  },
  EmptyListOf() {
    return [];
  },
  _iter(...children) {
    return children.map((c) => c.toAst());
  },
  _terminal() {
    return this.sourceString;
  },
});

export function parseFormula(formula: string, cellPos: Position): Node {
  // TODO: throw on parse error
  const match = g.match(formula);
  pos = cellPos;
  return semantics(match).toAst();
}

export function parseLiteral(input: string, cellPos: Position) {
  const match = g.match(input, 'Literal');
  if (match.succeeded()) {
    pos = cellPos;
    return semantics(match).toAst();
  } else {
    return input;
  }
}