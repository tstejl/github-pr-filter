export interface SourceSpan {
  start: number;
  end: number;
}

interface QueryTokenBase {
  raw: string;
  span: SourceSpan | null;
}

export interface AtomToken extends QueryTokenBase {
  kind: "atom";
}

export interface BooleanOperatorToken extends QueryTokenBase {
  kind: "and" | "or";
}

export interface ParenthesisToken extends QueryTokenBase {
  kind: "lparen" | "rparen";
}

export interface TriviaToken extends QueryTokenBase {
  kind: "trivia";
}

export type QueryToken = AtomToken | BooleanOperatorToken | ParenthesisToken | TriviaToken;

export type QueryDiagnosticCode =
  | "dangling-escape"
  | "empty-group"
  | "missing-operand"
  | "unexpected-token"
  | "unmatched-parenthesis"
  | "unterminated-quote";

export interface QueryDiagnostic {
  code: QueryDiagnosticCode;
  message: string;
  span: SourceSpan;
}

interface QueryExpressionBase {
  span: SourceSpan | null;
}

export interface AtomExpression extends QueryExpressionBase {
  kind: "atom";
  token: AtomToken;
}

export interface GroupExpression extends QueryExpressionBase {
  kind: "group";
  expression: QueryExpression | null;
  open: ParenthesisToken;
  close: ParenthesisToken | null;
}

export interface BooleanLink {
  operator: "and" | "or";
  style: "explicit" | "implicit";
  raw: string;
  span: SourceSpan | null;
}

export interface JunctionExpression extends QueryExpressionBase {
  kind: "and" | "or";
  terms: readonly QueryExpression[];
  links: readonly BooleanLink[];
}

export type QueryExpression = AtomExpression | GroupExpression | JunctionExpression;

export interface QueryDocument {
  source: string;
  tokens: readonly QueryToken[];
  root: QueryExpression | null;
  diagnostics: readonly QueryDiagnostic[];
}

interface LexResult {
  tokens: QueryToken[];
  diagnostics: QueryDiagnostic[];
}

function isWhitespace(character: string): boolean {
  return /\s/u.test(character);
}

function lexGitHubQuery(source: string): LexResult {
  const tokens: QueryToken[] = [];
  const diagnostics: QueryDiagnostic[] = [];
  let index = 0;

  while (index < source.length) {
    const start = index;
    const character = source[index];

    if (character === undefined) {
      break;
    }

    if (isWhitespace(character)) {
      index += 1;
      while (index < source.length && isWhitespace(source[index] ?? "")) {
        index += 1;
      }
      tokens.push({ kind: "trivia", raw: source.slice(start, index), span: { start, end: index } });
      continue;
    }

    if (character === "(" || character === ")") {
      index += 1;
      tokens.push({
        kind: character === "(" ? "lparen" : "rparen",
        raw: character,
        span: { start, end: index }
      });
      continue;
    }

    let quote: '"' | null = null;
    let quoteStart = -1;
    let escaped = false;

    while (index < source.length) {
      const atomCharacter = source[index];
      if (atomCharacter === undefined) {
        break;
      }

      if (escaped) {
        escaped = false;
        index += 1;
        continue;
      }

      if (atomCharacter === "\\") {
        escaped = true;
        index += 1;
        continue;
      }

      if (quote !== null) {
        if (atomCharacter === quote) {
          quote = null;
        }
        index += 1;
        continue;
      }

      if (atomCharacter === '"') {
        quote = '"';
        quoteStart = index;
        index += 1;
        continue;
      }

      if (isWhitespace(atomCharacter) || atomCharacter === "(" || atomCharacter === ")") {
        break;
      }

      index += 1;
    }

    const raw = source.slice(start, index);
    const kind = raw === "AND" ? "and" : raw === "OR" ? "or" : "atom";
    tokens.push({ kind, raw, span: { start, end: index } });

    if (quote !== null) {
      diagnostics.push({
        code: "unterminated-quote",
        message: `Unterminated ${quote} quote.`,
        span: { start: quoteStart, end: source.length }
      });
    }

    if (escaped) {
      diagnostics.push({
        code: "dangling-escape",
        message: "A trailing escape character has nothing to escape.",
        span: { start: Math.max(start, source.length - 1), end: source.length }
      });
    }
  }

  return { tokens, diagnostics };
}

type SignificantToken = Exclude<QueryToken, TriviaToken>;

function isSignificantToken(token: QueryToken): token is SignificantToken {
  return token.kind !== "trivia";
}

function isPrimaryStart(
  token: SignificantToken | undefined
): token is AtomToken | (ParenthesisToken & { kind: "lparen" }) {
  return token?.kind === "atom" || token?.kind === "lparen";
}

function expressionSpan(
  first: QueryExpression | QueryToken,
  last: QueryExpression | QueryToken
): SourceSpan | null {
  if (first.span === null || last.span === null) {
    return null;
  }
  return { start: first.span.start, end: last.span.end };
}

class QueryParser {
  private index = 0;

  constructor(
    private readonly source: string,
    private readonly tokens: readonly SignificantToken[],
    private readonly diagnostics: QueryDiagnostic[]
  ) {}

  parse(): QueryExpression | null {
    const expression = this.parseOr();

    while (this.peek() !== undefined) {
      const token = this.consume();
      if (token === undefined || token.span === null) {
        continue;
      }

      this.diagnostics.push({
        code: token.kind === "rparen" ? "unmatched-parenthesis" : "unexpected-token",
        message:
          token.kind === "rparen"
            ? "Closing parenthesis has no matching opening parenthesis."
            : `Unexpected token ${JSON.stringify(token.raw)}.`,
        span: token.span
      });
    }

    return expression;
  }

  private peek(): SignificantToken | undefined {
    return this.tokens[this.index];
  }

  private consume(): SignificantToken | undefined {
    const token = this.peek();
    if (token !== undefined) {
      this.index += 1;
    }
    return token;
  }

  private parseOr(): QueryExpression | null {
    const first = this.parseAnd();
    if (first === null) {
      return null;
    }

    const terms: QueryExpression[] = [first];
    const links: BooleanLink[] = [];

    while (this.peek()?.kind === "or") {
      const operator = this.consume();
      if (operator === undefined) {
        break;
      }

      const right = this.parseAnd();
      if (right === null) {
        this.addMissingOperand(operator);
        break;
      }

      links.push({ operator: "or", style: "explicit", raw: operator.raw, span: operator.span });
      terms.push(right);
    }

    return terms.length === 1 ? first : this.junction("or", terms, links);
  }

  private parseAnd(): QueryExpression | null {
    const first = this.parsePrimary();
    if (first === null) {
      return null;
    }

    const terms: QueryExpression[] = [first];
    const links: BooleanLink[] = [];

    while (true) {
      const next = this.peek();
      let link: BooleanLink | null = null;

      if (next?.kind === "and") {
        const operator = this.consume();
        if (operator === undefined) {
          break;
        }
        link = {
          operator: "and",
          style: "explicit",
          raw: operator.raw,
          span: operator.span
        };
      } else if (isPrimaryStart(next)) {
        const previous = terms.at(-1);
        const start = previous?.span?.end ?? next.span?.start ?? 0;
        const end = next.span?.start ?? start;
        link = {
          operator: "and",
          style: "implicit",
          raw: this.source.slice(start, end),
          span: { start, end }
        };
      } else {
        break;
      }

      const right = this.parsePrimary();
      if (right === null) {
        this.addMissingOperand(next);
        break;
      }

      links.push(link);
      terms.push(right);
    }

    return terms.length === 1 ? first : this.junction("and", terms, links);
  }

  private parsePrimary(): QueryExpression | null {
    const token = this.peek();
    if (token?.kind === "atom") {
      this.consume();
      return { kind: "atom", token, span: token.span };
    }

    if (token?.kind !== "lparen") {
      return null;
    }

    const open = token;
    this.consume();

    const possibleEmptyClose = this.peek();
    if (possibleEmptyClose?.kind === "rparen") {
      this.consume();
      const close = possibleEmptyClose;
      const span = expressionSpan(open, close);
      if (span !== null) {
        this.diagnostics.push({
          code: "empty-group",
          message: "A parenthesized query must contain an expression.",
          span
        });
      }
      return { kind: "group", expression: null, open, close, span };
    }

    const expression = this.parseOr();
    const possibleClose = this.peek();
    const close = possibleClose?.kind === "rparen" ? possibleClose : null;
    if (close !== null) {
      this.consume();
    }

    if (close === null && open.span !== null) {
      this.diagnostics.push({
        code: "unmatched-parenthesis",
        message: "Opening parenthesis has no matching closing parenthesis.",
        span: open.span
      });
    }

    const last = close ?? expression ?? open;
    return {
      kind: "group",
      expression,
      open,
      close,
      span: expressionSpan(open, last)
    };
  }

  private junction(
    kind: "and" | "or",
    terms: readonly QueryExpression[],
    links: readonly BooleanLink[]
  ): JunctionExpression {
    const first = terms[0];
    const last = terms.at(-1);
    return {
      kind,
      terms,
      links,
      span: first === undefined || last === undefined ? null : expressionSpan(first, last)
    };
  }

  private addMissingOperand(operator: SignificantToken | undefined): void {
    const position = operator?.span ?? { start: this.source.length, end: this.source.length };
    this.diagnostics.push({
      code: "missing-operand",
      message: "Boolean operator is missing an expression.",
      span: position
    });
  }
}

export function parseGitHubQuery(source: string): QueryDocument {
  const lexed = lexGitHubQuery(source);
  const significantTokens = lexed.tokens.filter(isSignificantToken);
  const parser = new QueryParser(source, significantTokens, lexed.diagnostics);

  return {
    source,
    tokens: lexed.tokens,
    root: parser.parse(),
    diagnostics: lexed.diagnostics
  };
}

export function hasOuterAttachedParenthesis(document: QueryDocument): boolean {
  return document.tokens.some((token) => {
    if (!token.span) {
      return false;
    }
    if (token.kind === "lparen") {
      const previous = document.source[token.span.start - 1];
      return previous !== undefined && !isWhitespace(previous);
    }
    if (token.kind === "rparen") {
      const next = document.source[token.span.end];
      return next !== undefined && !isWhitespace(next);
    }
    return false;
  });
}

export function createQueryAtom(raw: string): AtomExpression {
  const token: AtomToken = { kind: "atom", raw, span: null };
  return { kind: "atom", token, span: null };
}

export function combineQueryExpressions(
  kind: "and" | "or",
  terms: readonly QueryExpression[]
): QueryExpression | null {
  if (terms.length === 0) {
    return null;
  }
  if (terms.length === 1) {
    return terms[0] ?? null;
  }

  const links = terms.slice(1).map<BooleanLink>(() => ({
    operator: kind,
    style: kind === "and" ? "implicit" : "explicit",
    raw: kind === "and" ? " " : "OR",
    span: null
  }));
  const first = terms[0];
  const last = terms.at(-1);

  return {
    kind,
    terms,
    links,
    span: first === undefined || last === undefined ? null : expressionSpan(first, last)
  };
}

function precedence(expression: QueryExpression): number {
  if (expression.kind === "or") {
    return 1;
  }
  if (expression.kind === "and") {
    return 2;
  }
  return 3;
}

function serializeExpression(expression: QueryExpression, parentPrecedence: number): string {
  if (expression.kind === "atom") {
    return expression.token.raw;
  }

  if (expression.kind === "group") {
    return `(${expression.expression === null ? "" : serializeExpression(expression.expression, 0)})`;
  }

  const ownPrecedence = precedence(expression);
  let serialized = "";

  for (const [index, term] of expression.terms.entries()) {
    if (index > 0) {
      const link = expression.links[index - 1];
      if (expression.kind === "or") {
        serialized += ` ${link?.raw || "OR"} `;
      } else if (link?.style === "explicit") {
        serialized += ` ${link.raw || "AND"} `;
      } else {
        serialized += " ";
      }
    }
    serialized += serializeExpression(term, ownPrecedence);
  }

  return ownPrecedence < parentPrecedence ? `(${serialized})` : serialized;
}

export function serializeGitHubQuery(expression: QueryExpression | null): string {
  return expression === null ? "" : serializeExpression(expression, 0);
}
