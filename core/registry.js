// Parser registry. Each parser is { match(name) -> bool, parse(text, name) -> Series[] }.
// A "Series" is { id, dataType, label, unit, xs: Float64Array, ys: Float64Array }
// where xs are unix timestamps in SECONDS (uPlot's native time unit) and ys the values.
// Parsers register themselves at import time; adding a data type = add one parser file.

const parsers = [];

export function register(parser) {
  parsers.push(parser);
}

export function findParser(name) {
  for (const p of parsers) {
    if (p.match(name)) return p;
  }
  return null;
}
