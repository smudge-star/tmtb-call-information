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
const returnSummary = data.signal_return_summary || {};

function resetExistingSheet(sheet, mergedRanges) {
  for (const range of mergedRanges) {
    try { sheet.unmergeCells(range); } catch {}
  }
  for (const table of [...sheet.tables.items]) table.delete();
  sheet.deleteAllDrawings();
  sheet.getUsedRange().clear({ applyTo: "all" });
}

const signalsSheet = workbook.worksheets.getItem("Signals");
resetExistingSheet(signalsSheet, ["A2:G2", "A3:G3", "H2:P2"]);
signalsSheet.showGridLines = false;
signalsSheet.tabColor = navy;
signalsSheet.getRange("A2:G2").merge();
signalsSheet.getRange("A2").values = [["TMTB favorable stock setups and risk/reward comments"]];
signalsSheet.getRange("A2:G2").format = { font: { name: font, size: 15, bold: true, color: navy }, borders: { bottom: { style: "thin", color: navy } } };
signalsSheet.getRange("A3:G3").merge();
signalsSheet.getRange("A3").values = [["Yahoo Finance adjusted-close returns. Every call enters at the first ticker trading close strictly after publication. Exit is the first close on or after 1 or 3 calendar months. Pending and Yahoo-unavailable periods are excluded from averages."]];
signalsSheet.getRange("A3:G3").format = { font: { name: font, size: 10, italic: true, color: "#595959" }, wrapText: true, verticalAlignment: "center" };
signalsSheet.getRange("H2:P2").merge();
signalsSheet.getRange("H2").values = [["Forward-return summary (realized calls only)"]];
signalsSheet.getRange("H2:P2").format = { fill: paleBlue, font: { name: font, size: 10, bold: true, color: navy }, horizontalAlignment: "left" };
signalsSheet.getRange("H3:O4").values = [
  ["1M average", safe(returnSummary.m1_average), "1M calls", returnSummary.m1_calls ?? 0, "1M win rate", safe(returnSummary.m1_win_rate), "Latest Yahoo close", asDate(returnSummary.latest_yahoo_close)],
  ["3M average", safe(returnSummary.m3_average), "3M calls", returnSummary.m3_calls ?? 0, "3M win rate", safe(returnSummary.m3_win_rate), "Return basis", "Adjusted close"],
];
signalsSheet.getRange("H3:O4").format = { font: { name: font, size: 9, color: "#222222" }, verticalAlignment: "center" };
signalsSheet.getRange("I3:I4").setNumberFormat("0.0%");
signalsSheet.getRange("M3:M4").setNumberFormat("0.0%");
signalsSheet.getRange("O3").setNumberFormat("yyyy-mm-dd");
const signalHeaders = ["Ticker", "Date", "Edition", "TMTB sentence(s)", "Signal", "Qualification", "Source", "Entry / planned date", "Entry adj. close", "1M date", "1M adj. close", "1M return", "3M date", "3M adj. close", "3M return", "Return status"];
signalsSheet.getRange("A5:P5").values = [signalHeaders];
const signalEnd = 5 + data.calls.length;
signalsSheet.getRange(`A6:P${signalEnd}`).values = data.calls.map((row) => [
  row.ticker, asDate(row.call_date), row.edition, row.quote, row.signal, row.qualifier, row.source || "",
  asDate(row.entry_date), safe(row.entry_adj_close), asDate(row.m1_date), safe(row.m1_adj_close), safe(row.m1_return),
  asDate(row.m3_date), safe(row.m3_adj_close), safe(row.m3_return), row.return_status,
]);
signalsSheet.getRange("A5:P5").format = { fill: navy, font: { name: font, size: 9, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
signalsSheet.getRange(`A6:P${signalEnd}`).format = { font: { name: font, size: 9, color: "#222222" }, verticalAlignment: "top", wrapText: true };
for (const col of ["B", "H", "J", "M"]) signalsSheet.getRange(`${col}6:${col}${signalEnd}`).setNumberFormat("yyyy-mm-dd");
for (const col of ["I", "K", "N"]) signalsSheet.getRange(`${col}6:${col}${signalEnd}`).setNumberFormat("0.00");
for (const col of ["L", "O"]) {
  signalsSheet.getRange(`${col}6:${col}${signalEnd}`).setNumberFormat("0.0%");
  signalsSheet.getRange(`${col}6:${col}${signalEnd}`).conditionalFormats.add("cellIs", { operator: "greaterThanOrEqual", formula: 0, format: { fill: "#E2F0D9", font: { color: "#548235" } } });
  signalsSheet.getRange(`${col}6:${col}${signalEnd}`).conditionalFormats.add("cellIs", { operator: "lessThan", formula: 0, format: { fill: "#FCE4D6", font: { color: "#C00000" } } });
}
signalsSheet.tables.add(`A5:P${signalEnd}`, true, "TMTBSignals").style = "TableStyleMedium2";
signalsSheet.getRange("A:A").format.columnWidth = 10;
signalsSheet.getRange("B:C").format.columnWidth = 13;
signalsSheet.getRange("D:D").format.columnWidth = 54;
signalsSheet.getRange("E:F").format.columnWidth = 28;
signalsSheet.getRange("G:G").format.columnWidth = 36;
signalsSheet.getRange("H:O").format.columnWidth = 14;
signalsSheet.getRange("P:P").format.columnWidth = 22;
signalsSheet.getRange("2:2").format.rowHeight = 26;
signalsSheet.getRange("3:3").format.rowHeight = 50;
signalsSheet.getRange("5:5").format.rowHeight = 42;
signalsSheet.freezePanes.freezeRows(5);

const filesSheet = workbook.worksheets.getItem("Files reviewed");
resetExistingSheet(filesSheet, ["A2:F2", "A3:F3"]);
filesSheet.showGridLines = false;
filesSheet.tabColor = "#9DC3E6";
filesSheet.getRange("A2:F2").merge();
filesSheet.getRange("A2").values = [["Markdown file review coverage"]];
filesSheet.getRange("A2:F2").format = { font: { name: font, size: 15, bold: true, color: navy }, borders: { bottom: { style: "thin", color: navy } } };
filesSheet.getRange("A3:F3").merge();
filesSheet.getRange("A3").values = [["Every Markdown file in the current reviewed manifest is listed below. Signals retained is the number of favorable ticker-specific calls kept from that file."]];
filesSheet.getRange("A3:F3").format = { font: { name: font, size: 10, italic: true, color: "#595959" }, wrapText: true, verticalAlignment: "center" };
filesSheet.getRange("A5:F5").values = [["Date", "Edition", "File", "Review status", "Signals retained", "Source"]];
const filesEnd = 5 + data.reviewed_files.length;
filesSheet.getRange(`A6:F${filesEnd}`).values = data.reviewed_files.map((row) => [asDate(row.date), row.edition, row.file, row.review_status, row.signals_retained, row.source || ""]);
filesSheet.getRange("A5:F5").format = { fill: navy, font: { name: font, size: 9, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
filesSheet.getRange(`A6:F${filesEnd}`).format = { font: { name: font, size: 9, color: "#222222" }, verticalAlignment: "top" };
filesSheet.getRange(`A6:A${filesEnd}`).setNumberFormat("yyyy-mm-dd");
filesSheet.getRange(`E6:E${filesEnd}`).setNumberFormat("0");
filesSheet.tables.add(`A5:F${filesEnd}`, true, "TMTBFilesReviewed").style = "TableStyleMedium2";
filesSheet.getRange("A:A").format.columnWidth = 13;
filesSheet.getRange("B:B").format.columnWidth = 12;
filesSheet.getRange("C:C").format.columnWidth = 52;
filesSheet.getRange("D:D").format.columnWidth = 16;
filesSheet.getRange("E:E").format.columnWidth = 18;
filesSheet.getRange("F:F").format.columnWidth = 46;
filesSheet.getRange("2:2").format.rowHeight = 26;
filesSheet.getRange("3:3").format.rowHeight = 36;
filesSheet.getRange("5:5").format.rowHeight = 42;
filesSheet.freezePanes.freezeRows(5);

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
summary.getRange("A6:B18").values = [
  ["Audit period", `${data.parameters.start_date} to ${data.parameters.end_date}`],
  ["Realized price data", `${data.parameters.start_date} to ${data.parameters.realized_end_date || data.parameters.price_data_end_date}`],
  ["Signal calls", data.parameters.signals],
  ["Included / pending / excluded", `${data.parameters.included_calls} / ${data.parameters.pending_calls || 0} / ${data.parameters.excluded_calls}`],
  ["Holding periods", (data.parameters.horizons || [21, 63]).map((v) => `${v} trading days`).join(" and ")],
  ["Execution", data.parameters.entry_rule],
  ["Repeated call", data.parameters.repeat_call_rule],
  ["Rebalance", data.parameters.rebalance_rule],
  ["Position sizing", data.parameters.weight_rule],
  ["Cash return", data.parameters.cash_return],
  ["One-way transaction cost", `${data.parameters.cost_bps} bps per one-way turnover`],
  ["Benchmark", data.parameters.benchmark],
  ["Price source", `${data.parameters.price_source}; as of ${data.parameters.as_of_date}`],
];
summary.getRange("A5:B18").format = { font: { name: font, size: 10 }, verticalAlignment: "center", wrapText: true };
summary.getRange("A5:B5").format = {
  fill: navy,
  font: { name: font, size: 10, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  borders: { preset: "outside", style: "thin", color: border },
};
summary.getRange("A6:B18").format.borders = { insideHorizontal: { style: "thin", color: "#E1E6EB" }, bottom: { style: "thin", color: border } };
summary.getRange("B15:B15").setNumberFormat("0.0%");

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
summary.getRange("A32:D40").values = [
  ["Average invested", h21.average_invested_pct, h63.average_invested_pct, "Residual capital is cash"],
  ["Average cash", h21.average_cash_pct, h63.average_cash_pct, "Cash earns 0%"],
  ["Annualized turnover", h21.annualized_turnover, h63.annualized_turnover, "One-way turnover"],
  ["Rebalance days", h21.rebalance_days, h63.rebalance_days, "Calls, expiries and 20% cap drift"],
  ["Repeated calls reset", h21.reset_calls, h63.reset_calls, "Reset count depends on horizon"],
  ["Maximum observed weight", h21.max_observed_weight, h63.max_observed_weight, "Checked every close"],
  ["Current cash", h21.current_cash_pct, h63.current_cash_pct, "At the last available close"],
  ["Pending calls", data.parameters.pending_calls || 0, data.parameters.pending_calls || 0, "Planned entries have no realized price yet"],
  ["Failed Yahoo tickers", failed, failed, "Excluded calls are disclosed, not silently dropped"],
];
summary.getRange("A31:D40").format = { font: { name: font, size: 10 }, verticalAlignment: "center", wrapText: true };
summary.getRange("A31:D31").format = { fill: paleBlue, font: { name: font, size: 10, bold: true, color: navy }, horizontalAlignment: "center" };
summary.getRange("B32:C33").setNumberFormat("0.0%");
summary.getRange("B34:C34").setNumberFormat("0.0x");
summary.getRange("B35:C36").setNumberFormat("0");
summary.getRange("B37:C38").setNumberFormat("0.0%");
summary.getRange("B39:C39").setNumberFormat("0");
summary.getRange("A32:D40").format.borders = { insideHorizontal: { style: "thin", color: "#E1E6EB" }, bottom: { style: "thin", color: border } };

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
summary.getRange("10:14").format.rowHeight = 60;
summary.getRange("15:18").format.rowHeight = 36;

daily.getRange("A2:AF2").merge();
daily.getRange("A2").values = [["Daily portfolio audit trail"]];
daily.getRange("A2:AF2").format = { font: { name: font, size: 14, bold: true, color: navy }, borders: { bottom: { style: "thin", color: navy } } };
daily.getRange("A3:AF3").merge();
daily.getRange("A3").values = [["Close-to-close adjusted returns. Observed rows use realized prices; rows marked No Yahoo close carry NAV forward and show planned calls/baskets separately without inventing a return."]];
daily.getRange("A3:AF3").format = { font: { name: font, size: 10, italic: true, color: "#595959" }, wrapText: true };

const dailyHeaders = [
  "Date", "Data status", "QQQ adj. close", "QQQ NAV",
  "21D gross NAV", "21D net NAV", "21D daily net return", "21D active", "21D invested", "21D cash", "21D turnover", "21D event", "21D active tickers",
  "21D planned active", "21D planned invested", "21D planned cash", "21D planned positions", "21D pending calls",
  "63D gross NAV", "63D net NAV", "63D daily net return", "63D active", "63D invested", "63D cash", "63D turnover", "63D event", "63D active tickers",
  "63D planned active", "63D planned invested", "63D planned cash", "63D planned positions", "63D pending calls",
];
daily.getRange("A5:AF5").values = [dailyHeaders];
const dailyEnd = 5 + data.daily.length;
daily.getRange(`A6:AF${dailyEnd}`).values = data.daily.map((row) => [
  asDate(row.date), row.data_status, safe(row.qqq_adj_close), row.qqq_nav,
  row.h21_gross_nav, row.h21_net_nav, row.h21_daily_net_return, row.h21_active_count, row.h21_invested_pct, row.h21_cash_pct,
  row.h21_turnover, row.h21_event, row.h21_active_tickers, row.h21_planned_active_count, row.h21_planned_invested_pct,
  row.h21_planned_cash_pct, row.h21_planned_positions, row.h21_pending_calls,
  row.h63_gross_nav, row.h63_net_nav, row.h63_daily_net_return, row.h63_active_count, row.h63_invested_pct, row.h63_cash_pct,
  row.h63_turnover, row.h63_event, row.h63_active_tickers, row.h63_planned_active_count, row.h63_planned_invested_pct,
  row.h63_planned_cash_pct, row.h63_planned_positions, row.h63_pending_calls,
]);
daily.getRange("A5:AF5").format = { fill: navy, font: { name: font, size: 9, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
daily.getRange(`A6:AF${dailyEnd}`).format = { font: { name: font, size: 9, color: "#222222" }, verticalAlignment: "top", wrapText: true };
daily.getRange(`A6:A${dailyEnd}`).setNumberFormat("yyyy-mm-dd");
daily.getRange(`C6:C${dailyEnd}`).setNumberFormat("0.00");
daily.getRange(`D6:F${dailyEnd}`).setNumberFormat("0.000x");
daily.getRange(`G6:G${dailyEnd}`).setNumberFormat("0.00%");
daily.getRange(`H6:H${dailyEnd}`).setNumberFormat("0");
daily.getRange(`I6:K${dailyEnd}`).setNumberFormat("0.0%");
daily.getRange(`N6:N${dailyEnd}`).setNumberFormat("0");
daily.getRange(`O6:P${dailyEnd}`).setNumberFormat("0.0%");
daily.getRange(`S6:T${dailyEnd}`).setNumberFormat("0.000x");
daily.getRange(`U6:U${dailyEnd}`).setNumberFormat("0.00%");
daily.getRange(`V6:V${dailyEnd}`).setNumberFormat("0");
daily.getRange(`W6:Y${dailyEnd}`).setNumberFormat("0.0%");
daily.getRange(`AB6:AB${dailyEnd}`).setNumberFormat("0");
daily.getRange(`AC6:AD${dailyEnd}`).setNumberFormat("0.0%");
daily.tables.add(`A5:AF${dailyEnd}`, true, "TMTBBacktestDaily").style = "TableStyleMedium2";

daily.getRange("AH2:AU2").merge();
daily.getRange("AH2").values = [["Call execution and holding-period audit"]];
daily.getRange("AH2:AU2").format = { font: { name: font, size: 14, bold: true, color: navy }, borders: { bottom: { style: "thin", color: navy } } };
daily.getRange("AH3:AU3").merge();
daily.getRange("AH3").values = [["Included calls use the first ticker trading close strictly after publication. Pending calls show a planned date but no realized price; expiry dates are trading-session based."]];
daily.getRange("AH3:AU3").format = { font: { name: font, size: 10, italic: true, color: "#595959" }, wrapText: true };
const callHeaders = ["Call ID", "Ticker", "Call date", "Edition", "Source file", "Source URL", "Quoted sentence", "Entry / planned date", "Entry adj. close", "21D action", "21D expiry", "63D action", "63D expiry", "Status"];
daily.getRange("AH5:AU5").values = [callHeaders];
const callEnd = 5 + data.calls.length;
daily.getRange(`AH6:AU${callEnd}`).values = data.calls.map((row) => [
  row.call_id, row.ticker, asDate(row.call_date), row.edition, row.file, row.source || "", row.quote, asDate(row.entry_date), safe(row.entry_adj_close),
  row.h21_action || "", row.h21_expiry_date ? asDate(row.h21_expiry_date) : "After test", row.h63_action || "", row.h63_expiry_date ? asDate(row.h63_expiry_date) : "After test", row.status,
]);
daily.getRange("AH5:AU5").format = { fill: navy, font: { name: font, size: 9, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
daily.getRange(`AH6:AU${callEnd}`).format = { font: { name: font, size: 9, color: "#222222" }, verticalAlignment: "top", wrapText: true };
daily.getRange(`AJ6:AJ${callEnd}`).setNumberFormat("yyyy-mm-dd");
daily.getRange(`AO6:AO${callEnd}`).setNumberFormat("yyyy-mm-dd");
daily.getRange(`AP6:AP${callEnd}`).setNumberFormat("0.00");
daily.getRange(`AR6:AR${callEnd}`).setNumberFormat("yyyy-mm-dd");
daily.getRange(`AT6:AT${callEnd}`).setNumberFormat("yyyy-mm-dd");
daily.tables.add(`AH5:AU${callEnd}`, true, "TMTBBacktestCalls").style = "TableStyleMedium2";

daily.getRange("A:A").format.columnWidth = 13;
daily.getRange("B:B").format.columnWidth = 28;
daily.getRange("C:D").format.columnWidth = 14;
daily.getRange("E:F").format.columnWidth = 15;
daily.getRange("G:G").format.columnWidth = 13;
daily.getRange("H:H").format.columnWidth = 10;
daily.getRange("I:K").format.columnWidth = 13;
daily.getRange("L:L").format.columnWidth = 28;
daily.getRange("M:M").format.columnWidth = 38;
daily.getRange("N:N").format.columnWidth = 12;
daily.getRange("O:P").format.columnWidth = 13;
daily.getRange("Q:Q").format.columnWidth = 38;
daily.getRange("R:R").format.columnWidth = 32;
daily.getRange("S:T").format.columnWidth = 15;
daily.getRange("U:U").format.columnWidth = 13;
daily.getRange("V:V").format.columnWidth = 10;
daily.getRange("W:Y").format.columnWidth = 13;
daily.getRange("Z:Z").format.columnWidth = 28;
daily.getRange("AA:AA").format.columnWidth = 38;
daily.getRange("AB:AB").format.columnWidth = 12;
daily.getRange("AC:AD").format.columnWidth = 13;
daily.getRange("AE:AE").format.columnWidth = 38;
daily.getRange("AF:AF").format.columnWidth = 32;
daily.getRange("AG:AG").format.columnWidth = 3;
daily.getRange("AH:AH").format.columnWidth = 10;
daily.getRange("AI:AI").format.columnWidth = 10;
daily.getRange("AJ:AJ").format.columnWidth = 13;
daily.getRange("AK:AK").format.columnWidth = 11;
daily.getRange("AL:AL").format.columnWidth = 38;
daily.getRange("AM:AM").format.columnWidth = 34;
daily.getRange("AN:AN").format.columnWidth = 52;
daily.getRange("AO:AO").format.columnWidth = 13;
daily.getRange("AP:AP").format.columnWidth = 15;
daily.getRange("AQ:AQ").format.columnWidth = 26;
daily.getRange("AR:AR").format.columnWidth = 13;
daily.getRange("AS:AS").format.columnWidth = 12;
daily.getRange("AT:AT").format.columnWidth = 13;
daily.getRange("AU:AU").format.columnWidth = 26;
daily.getRange("2:2").format.rowHeight = 26;
daily.getRange("3:3").format.rowHeight = 36;
daily.getRange("5:5").format.rowHeight = 42;
daily.freezePanes.freezeRows(5);
daily.freezePanes.freezeColumns(1);

workbook.recalculate();

const summaryInspect = await workbook.inspect({ kind: "table", range: "Backtest!A2:Q42", include: "values,formulas", tableMaxRows: 48, tableMaxCols: 18, maxChars: 18000 });
console.log(summaryInspect.ndjson);
const dailyInspect = await workbook.inspect({ kind: "table", range: "Backtest daily!A2:AF12", include: "values,formulas", tableMaxRows: 15, tableMaxCols: 32, maxChars: 18000 });
console.log(dailyInspect.ndjson);
const callInspect = await workbook.inspect({ kind: "table", range: "Backtest daily!AH2:AU12", include: "values,formulas", tableMaxRows: 15, tableMaxCols: 14, maxChars: 16000 });
console.log(callInspect.ndjson);
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 300 }, summary: "TMTB backtest workbook formula error scan" });
console.log(errors.ndjson);

const outputDir = path.dirname(outputPath);
await fs.mkdir(outputDir, { recursive: true });
const signalsPreview = await workbook.render({ sheetName: "Signals", range: "A1:P18", scale: 1, format: "png" });
await fs.writeFile(path.join(outputDir, `${path.basename(outputPath, path.extname(outputPath))}_signals.png`), new Uint8Array(await signalsPreview.arrayBuffer()));
const filesPreview = await workbook.render({ sheetName: "Files reviewed", range: "A1:F18", scale: 1, format: "png" });
await fs.writeFile(path.join(outputDir, `${path.basename(outputPath, path.extname(outputPath))}_files.png`), new Uint8Array(await filesPreview.arrayBuffer()));
const summaryPreview = await workbook.render({ sheetName: "Backtest", range: "A1:Q42", scale: 1.05, format: "png" });
await fs.writeFile(path.join(outputDir, `${path.basename(outputPath, path.extname(outputPath))}_summary.png`), new Uint8Array(await summaryPreview.arrayBuffer()));
const dailyPreview = await workbook.render({ sheetName: "Backtest daily", range: "A1:AF18", scale: 1, format: "png" });
await fs.writeFile(path.join(outputDir, `${path.basename(outputPath, path.extname(outputPath))}_daily.png`), new Uint8Array(await dailyPreview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ workbookPath: outputPath, dailyRows: data.daily.length, callRows: data.calls.length, checks: data.checks }, null, 2));
