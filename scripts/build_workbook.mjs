import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    args[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.template || !args.data || !args.output) {
  throw new Error("Usage: node build_workbook.mjs --template TEMPLATE.xlsx --data BACKTEST.json --output OUTPUT.xlsx");
}

const templatePath = path.resolve(String(args.template));
const dataPath = path.resolve(String(args.data));
const outputPath = path.resolve(String(args.output));
const artifactModule = args["artifact-tool"]
  ? await import(pathToFileURL(path.resolve(String(args["artifact-tool"]))).href)
  : await import("@oai/artifact-tool");
const { FileBlob, SpreadsheetFile } = artifactModule;
const data = JSON.parse(await fs.readFile(dataPath, "utf8"));
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(templatePath));

const font = "Arial";
const navy = "#17365D";
const blue = "#4472C4";
const green = "#70AD47";
const gray = "#7F8C8D";
const paleBlue = "#D9EAF7";
const paleGray = "#F2F4F7";
const border = "#B8C2CC";
const horizonValues = (horizon) => data.summary[`h${horizon}`];
const h21 = horizonValues(21);
const h63 = horizonValues(63);
const qqq = data.summary.qqq;
const asDate = (value) => value ? new Date(`${value}T12:00:00Z`) : null;
const safe = (value) => value === undefined || value === null || Number.isNaN(value) ? null : value;
const totalCalls = data.parameters.signals ?? data.calls.length;
const failed = (data.parameters.failed_tickers || []).join(", ") || "None";

const summary = workbook.worksheets.add("Backtest");
const daily = workbook.worksheets.add("Backtest daily");
summary.tabColor = navy;
daily.tabColor = "#9DC3E6";
summary.showGridLines = false;
daily.showGridLines = false;

summary.getRange("A2:F2").merge();
summary.getRange("A2").values = [["TMTB call portfolio backtest"]];
summary.getRange("A2:F2").format = {
  font: { name: font, size: 15, bold: true, color: navy },
  verticalAlignment: "center",
  borders: { bottom: { style: "thin", color: navy } },
};
summary.getRange("A3:F3").merge();
summary.getRange("A3").values = [[
  "Every call enters at the first ticker trading close strictly after publication. A repeated call resets that ticker's horizon from the new entry. Active names are equal weighted, capped at 20%; residual capital stays in cash.",
]];
summary.getRange("A3:F3").format = {
  font: { name: font, size: 10, italic: true, color: "#595959" },
  wrapText: true,
  verticalAlignment: "center",
};

summary.getRange("A5:B5").values = [["Backtest assumptions", "Value"]];
summary.getRange("A6:B17").values = [
  ["Test period", `${data.parameters.start_date} to ${data.parameters.end_date}`],
  ["Signal calls", data.parameters.signals],
  ["Calls included / excluded", `${data.parameters.included_calls} / ${data.parameters.excluded_calls}`],
  ["Holding periods", (data.parameters.horizons || [21, 63]).map((v) => `${v} trading days`).join(" and ")],
  ["Execution", data.parameters.entry_rule],
  ["Repeated call", data.parameters.repeat_call_rule],
  ["Rebalance", data.parameters.rebalance_rule],
  ["Position sizing", data.parameters.weight_rule],
  ["Cash return", data.parameters.cash_return],
  ["One-way transaction cost", `${data.parameters.cost_bps} bps per one-way turnover`],
  ["Benchmark", data.parameters.benchmark],
  ["Price source", data.parameters.price_source],
];
summary.getRange("A5:B17").format = { font: { name: font, size: 10 }, verticalAlignment: "center", wrapText: true };
summary.getRange("A5:B5").format = {
  fill: navy,
  font: { name: font, size: 10, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  borders: { preset: "outside", style: "thin", color: border },
};
summary.getRange("A6:B17").format.borders = { insideHorizontal: { style: "thin", color: "#E1E6EB" }, bottom: { style: "thin", color: border } };
summary.getRange("B14:B14").setNumberFormat("0.0%");

summary.getRange("A20:F20").values = [["Performance metric", "21D gross", "21D net", "63D gross", "63D net", "QQQ"]];
summary.getRange("A21:F28").values = [
  ["Total return", h21.gross.total_return, h21.net.total_return, h63.gross.total_return, h63.net.total_return, qqq.total_return],
  ["CAGR", h21.gross.cagr, h21.net.cagr, h63.gross.cagr, h63.net.cagr, qqq.cagr],
  ["Annualized volatility", h21.gross.annualized_volatility, h21.net.annualized_volatility, h63.gross.annualized_volatility, h63.net.annualized_volatility, qqq.annualized_volatility],
  ["Sharpe ratio (rf = 0)", h21.gross.sharpe_rf_0, h21.net.sharpe_rf_0, h63.gross.sharpe_rf_0, h63.net.sharpe_rf_0, qqq.sharpe_rf_0],
  ["Maximum drawdown", h21.gross.max_drawdown, h21.net.max_drawdown, h63.gross.max_drawdown, h63.net.max_drawdown, qqq.max_drawdown],
  ["Beta vs QQQ", h21.gross.beta_vs_qqq, h21.net.beta_vs_qqq, h63.gross.beta_vs_qqq, h63.net.beta_vs_qqq, qqq.beta_vs_qqq],
  ["Annualized alpha vs QQQ", h21.gross.annualized_alpha_vs_qqq, h21.net.annualized_alpha_vs_qqq, h63.gross.annualized_alpha_vs_qqq, h63.net.annualized_alpha_vs_qqq, qqq.annualized_alpha_vs_qqq],
  ["Information ratio vs QQQ", h21.gross.information_ratio_vs_qqq, h21.net.information_ratio_vs_qqq, h63.gross.information_ratio_vs_qqq, h63.net.information_ratio_vs_qqq, null],
];
summary.getRange("A20:F28").format = { font: { name: font, size: 10 }, verticalAlignment: "center" };
summary.getRange("A20:F20").format = { fill: navy, font: { name: font, size: 10, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", wrapText: true };
summary.getRange("A21:A28").format.font = { name: font, size: 10, color: navy };
summary.getRange("B21:F23").setNumberFormat("0.0%");
summary.getRange("B24:F24").setNumberFormat("0.00");
summary.getRange("B25:F25").setNumberFormat("0.0%");
summary.getRange("B26:F26").setNumberFormat("0.00");
summary.getRange("B27:F27").setNumberFormat("0.0%");
summary.getRange("B28:F28").setNumberFormat("0.00");
summary.getRange("A21:F28").format.borders = { insideHorizontal: { style: "thin", color: "#E1E6EB" }, bottom: { style: "thin", color: border } };

summary.getRange("A31:D31").values = [["Portfolio mechanics", "21D", "63D", "Notes"]];
summary.getRange("A32:D39").values = [
  ["Average invested", h21.average_invested_pct, h63.average_invested_pct, "Residual capital is cash"],
  ["Average cash", h21.average_cash_pct, h63.average_cash_pct, "Cash earns 0%"],
  ["Annualized turnover", h21.annualized_turnover, h63.annualized_turnover, "One-way turnover"],
  ["Rebalance days", h21.rebalance_days, h63.rebalance_days, "Calls, expiries and 20% cap drift"],
  ["Repeated calls reset", h21.reset_calls, h63.reset_calls, "Reset count depends on horizon"],
  ["Maximum observed weight", h21.max_observed_weight, h63.max_observed_weight, "Checked every close"],
  ["Current cash", h21.current_cash_pct, h63.current_cash_pct, "At the last available close"],
  ["Failed Yahoo tickers", failed, failed, "Excluded calls are disclosed, not silently dropped"],
];
summary.getRange("A31:D39").format = { font: { name: font, size: 10 }, verticalAlignment: "center", wrapText: true };
summary.getRange("A31:D31").format = { fill: paleBlue, font: { name: font, size: 10, bold: true, color: navy }, horizontalAlignment: "center" };
summary.getRange("B32:C33").setNumberFormat("0.0%");
summary.getRange("B34:C34").setNumberFormat("0.0x");
summary.getRange("B35:C36").setNumberFormat("0");
summary.getRange("B37:C37").setNumberFormat("0.0%");
summary.getRange("B38:C38").setNumberFormat("0.0%");
summary.getRange("A32:D39").format.borders = { insideHorizontal: { style: "thin", color: "#E1E6EB" }, bottom: { style: "thin", color: border } };

summary.getRange("A42:D42").values = [["Month end", "21D net NAV", "63D net NAV", "QQQ NAV"]];
const monthRows = (data.chart_monthly || []).map((row) => [row.month, row.h21_net_nav, row.h63_net_nav, row.qqq_nav]);
if (monthRows.length) summary.getRange(`A43:D${42 + monthRows.length}`).values = monthRows;
summary.getRange(`A42:D${42 + Math.max(1, monthRows.length)}`).format.font = { name: font, size: 9 };
summary.getRange("A42:D42").format = { fill: paleGray, font: { name: font, size: 9, bold: true, color: navy }, horizontalAlignment: "center" };
if (monthRows.length) summary.getRange(`B43:D${42 + monthRows.length}`).setNumberFormat("0.00x");

const chartEnd = 42 + Math.max(1, monthRows.length);
const chart = summary.charts.add("line", summary.getRange(`A42:D${chartEnd}`));
chart.title = "Growth of $1: TMTB portfolios vs QQQ";
chart.titleTextStyle.fontSize = 12;
chart.titleTextStyle.typeface = font;
chart.legend = { position: "top", textStyle: { typeface: font, fontSize: 10 } };
chart.xAxis = { axisType: "textAxis", textStyle: { typeface: font, fontSize: 9 } };
chart.yAxis = { numberFormatCode: "0.0x", numberFormatSourceLinked: false, textStyle: { typeface: font, fontSize: 9 } };
chart.setPosition("H5", "Q25");
if (chart.series.items.length >= 3) {
  chart.series.items[0].line = { fill: blue, style: "solid", width: 2 };
  chart.series.items[1].line = { fill: green, style: "solid", width: 2 };
  chart.series.items[2].line = { fill: gray, style: "dashed", width: 2 };
}

const currentPositions = h21.current_positions || [];
summary.getRange("H28:J28").merge();
summary.getRange("H28").values = [["Current 21D basket"]];
summary.getRange("H28:J28").format = { fill: paleBlue, font: { name: font, size: 10, bold: true, color: navy }, horizontalAlignment: "left" };
summary.getRange("H29:J29").values = [["Ticker", "Weight", "Expiry"]];
summary.getRange("H29:J29").format = { fill: paleGray, font: { name: font, size: 9, bold: true, color: navy }, horizontalAlignment: "center" };
if (currentPositions.length) {
  summary.getRange(`H30:J${29 + currentPositions.length}`).values = currentPositions.map((row) => [row.ticker, row.weight, row.expiry_date ? asDate(row.expiry_date) : "After test"]);
  summary.getRange(`I30:I${29 + currentPositions.length}`).setNumberFormat("0.0%");
  summary.getRange(`J30:J${29 + currentPositions.length}`).setNumberFormat("yyyy-mm-dd");
}
summary.getRange("L28:Q34").merge();
summary.getRange("L28").values = [["Checks: " + Object.entries(data.checks || {}).map(([key, value]) => `${key}=${value ? "PASS" : "FAIL"}`).join("; ")]];
summary.getRange("L28:Q34").format = { fill: "#FFF2CC", font: { name: font, size: 9, color: "#7F6000" }, wrapText: true, verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: "#D6B656" } };

summary.getRange("A:A").format.columnWidth = 29;
summary.getRange("B:F").format.columnWidth = 16;
summary.getRange("D:D").format.columnWidth = 40;
summary.getRange("H:Q").format.columnWidth = 12;
summary.getRange("2:2").format.rowHeight = 26;
summary.getRange("3:3").format.rowHeight = 44;
summary.getRange("5:42").format.rowHeight = 22;
summary.getRange("9:9").format.rowHeight = 34;
summary.getRange("10:13").format.rowHeight = 60;
summary.getRange("15:17").format.rowHeight = 36;

daily.getRange("A2:U2").merge();
daily.getRange("A2").values = [["Daily portfolio audit trail"]];
daily.getRange("A2:U2").format = { font: { name: font, size: 14, bold: true, color: navy }, borders: { bottom: { style: "thin", color: navy } } };
daily.getRange("A3:U3").merge();
daily.getRange("A3").values = [["Close-to-close adjusted returns. Events are applied after that day's return and affect the following interval; costs are charged at the rebalance close."]];
daily.getRange("A3:U3").format = { font: { name: font, size: 10, italic: true, color: "#595959" }, wrapText: true };

const dailyHeaders = [
  "Date", "QQQ adj. close", "QQQ NAV", "21D gross NAV", "21D net NAV", "21D daily net return", "21D active", "21D invested", "21D cash", "21D turnover", "21D event", "21D active tickers",
  "63D gross NAV", "63D net NAV", "63D daily net return", "63D active", "63D invested", "63D cash", "63D turnover", "63D event", "63D active tickers",
];
daily.getRange("A5:U5").values = [dailyHeaders];
const dailyEnd = 5 + data.daily.length;
daily.getRange(`A6:U${dailyEnd}`).values = data.daily.map((row) => [
  asDate(row.date), row.qqq_adj_close, row.qqq_nav, row.h21_gross_nav, row.h21_net_nav, row.h21_daily_net_return,
  row.h21_active_count, row.h21_invested_pct, row.h21_cash_pct, row.h21_turnover, row.h21_event, row.h21_active_tickers,
  row.h63_gross_nav, row.h63_net_nav, row.h63_daily_net_return, row.h63_active_count, row.h63_invested_pct, row.h63_cash_pct,
  row.h63_turnover, row.h63_event, row.h63_active_tickers,
]);
daily.getRange("A5:U5").format = { fill: navy, font: { name: font, size: 9, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
daily.getRange(`A6:U${dailyEnd}`).format = { font: { name: font, size: 9, color: "#222222" }, verticalAlignment: "top" };
daily.getRange(`A6:A${dailyEnd}`).setNumberFormat("yyyy-mm-dd");
daily.getRange(`B6:B${dailyEnd}`).setNumberFormat("0.00");
daily.getRange(`C6:E${dailyEnd}`).setNumberFormat("0.000x");
daily.getRange(`F6:F${dailyEnd}`).setNumberFormat("0.00%");
daily.getRange(`G6:G${dailyEnd}`).setNumberFormat("0");
daily.getRange(`H6:J${dailyEnd}`).setNumberFormat("0.0%");
daily.getRange(`M6:N${dailyEnd}`).setNumberFormat("0.000x");
daily.getRange(`O6:O${dailyEnd}`).setNumberFormat("0.00%");
daily.getRange(`P6:P${dailyEnd}`).setNumberFormat("0");
daily.getRange(`Q6:S${dailyEnd}`).setNumberFormat("0.0%");
daily.tables.add(`A5:U${dailyEnd}`, true, "TMTBBacktestDaily").style = "TableStyleMedium2";

daily.getRange("W2:AJ2").merge();
daily.getRange("W2").values = [["Call execution and holding-period audit"]];
daily.getRange("W2:AJ2").format = { font: { name: font, size: 14, bold: true, color: navy }, borders: { bottom: { style: "thin", color: navy } } };
daily.getRange("W3:AJ3").merge();
daily.getRange("W3").values = [["Each included call uses the first ticker trading close strictly after its publication date. Expiry dates are trading-session based; a repeated call shows Reset."]];
daily.getRange("W3:AJ3").format = { font: { name: font, size: 10, italic: true, color: "#595959" }, wrapText: true };
const callHeaders = ["Call ID", "Ticker", "Call date", "Edition", "Source file", "Source URL", "Quoted sentence", "Entry date", "Entry adj. close", "21D action", "21D expiry", "63D action", "63D expiry", "Status"];
daily.getRange("W5:AJ5").values = [callHeaders];
const callEnd = 5 + data.calls.length;
daily.getRange(`W6:AJ${callEnd}`).values = data.calls.map((row) => [
  row.call_id, row.ticker, asDate(row.call_date), row.edition, row.file, row.source || "", row.quote, asDate(row.entry_date), safe(row.entry_adj_close),
  row.h21_action || "", row.h21_expiry_date ? asDate(row.h21_expiry_date) : "After test", row.h63_action || "", row.h63_expiry_date ? asDate(row.h63_expiry_date) : "After test", row.status,
]);
daily.getRange("W5:AJ5").format = { fill: navy, font: { name: font, size: 9, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
daily.getRange(`W6:AJ${callEnd}`).format = { font: { name: font, size: 9, color: "#222222" }, verticalAlignment: "top", wrapText: true };
daily.getRange(`Y6:Y${callEnd}`).setNumberFormat("yyyy-mm-dd");
daily.getRange(`AD6:AD${callEnd}`).setNumberFormat("yyyy-mm-dd");
daily.getRange(`AE6:AE${callEnd}`).setNumberFormat("0.00");
daily.getRange(`AG6:AG${callEnd}`).setNumberFormat("yyyy-mm-dd");
daily.getRange(`AI6:AI${callEnd}`).setNumberFormat("yyyy-mm-dd");
daily.tables.add(`W5:AJ${callEnd}`, true, "TMTBBacktestCalls").style = "TableStyleMedium2";

daily.getRange("A:A").format.columnWidth = 13;
daily.getRange("B:B").format.columnWidth = 14;
daily.getRange("C:F").format.columnWidth = 15;
daily.getRange("G:J").format.columnWidth = 13;
daily.getRange("K:K").format.columnWidth = 28;
daily.getRange("L:L").format.columnWidth = 38;
daily.getRange("M:O").format.columnWidth = 15;
daily.getRange("P:S").format.columnWidth = 13;
daily.getRange("T:T").format.columnWidth = 28;
daily.getRange("U:U").format.columnWidth = 38;
daily.getRange("V:V").format.columnWidth = 3;
daily.getRange("W:W").format.columnWidth = 10;
daily.getRange("X:X").format.columnWidth = 10;
daily.getRange("Y:Y").format.columnWidth = 13;
daily.getRange("Z:Z").format.columnWidth = 11;
daily.getRange("AA:AA").format.columnWidth = 38;
daily.getRange("AB:AB").format.columnWidth = 34;
daily.getRange("AC:AC").format.columnWidth = 52;
daily.getRange("AD:AD").format.columnWidth = 13;
daily.getRange("AE:AE").format.columnWidth = 15;
daily.getRange("AF:AF").format.columnWidth = 12;
daily.getRange("AG:AG").format.columnWidth = 13;
daily.getRange("AH:AH").format.columnWidth = 12;
daily.getRange("AI:AI").format.columnWidth = 13;
daily.getRange("AJ:AJ").format.columnWidth = 26;
daily.getRange("2:2").format.rowHeight = 26;
daily.getRange("3:3").format.rowHeight = 36;
daily.getRange("5:5").format.rowHeight = 42;
daily.freezePanes.freezeRows(5);
daily.freezePanes.freezeColumns(1);

workbook.recalculate();

const summaryInspect = await workbook.inspect({ kind: "table", range: "Backtest!A2:Q42", include: "values,formulas", tableMaxRows: 48, tableMaxCols: 18, maxChars: 18000 });
console.log(summaryInspect.ndjson);
const dailyInspect = await workbook.inspect({ kind: "table", range: "Backtest daily!A2:U12", include: "values,formulas", tableMaxRows: 15, tableMaxCols: 22, maxChars: 12000 });
console.log(dailyInspect.ndjson);
const callInspect = await workbook.inspect({ kind: "table", range: "Backtest daily!W2:AJ12", include: "values,formulas", tableMaxRows: 15, tableMaxCols: 14, maxChars: 16000 });
console.log(callInspect.ndjson);
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 300 }, summary: "TMTB backtest workbook formula error scan" });
console.log(errors.ndjson);

const outputDir = path.dirname(outputPath);
await fs.mkdir(outputDir, { recursive: true });
const summaryPreview = await workbook.render({ sheetName: "Backtest", range: "A1:Q42", scale: 1.05, format: "png" });
await fs.writeFile(path.join(outputDir, `${path.basename(outputPath, path.extname(outputPath))}_summary.png`), new Uint8Array(await summaryPreview.arrayBuffer()));
const dailyPreview = await workbook.render({ sheetName: "Backtest daily", range: "A1:U18", scale: 1, format: "png" });
await fs.writeFile(path.join(outputDir, `${path.basename(outputPath, path.extname(outputPath))}_daily.png`), new Uint8Array(await dailyPreview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ workbookPath: outputPath, dailyRows: data.daily.length, callRows: data.calls.length, checks: data.checks }, null, 2));
