// 節約貯金 ウィジェット (Scriptable用)
// ============================================
// 節約貯金アプリ (https://tabearyoshi-hash.github.io/setsuyaku-chokin/)
// の合計を iPhone ホーム画面ウィジェットに表示する Scriptable スクリプトです。
//
//
// 1. 節約貯金アプリを開き、「あとで使う用」カードの
// 「ウィジェット用ファイルを保存」を押します。
// 2. 保存先を「iCloud Drive」の「Scriptable」フォルダにして、
// ファイル名 setsuyaku-widget.json のまま保存します。
// （「このiPhone内」ではなく「iCloud Drive」を選んでください）
// 3. Scriptable アプリでこのスクリプトを新規作成して貼り付けます。
// 4. ホーム画面に Scriptable ウィジェット（小／中）を置き、
// ウィジェットの設定でこのスクリプトを選びます。
// 5. ウィジェットの表示を更新するには、ウィジェットをタップします。
// タップするとアプリが ?widget=1 付きで開き、設定タブのウィジェット欄で
// 保存ボタンが光った状態になるので、それをタップしてファイルを上書きします。
// ウィジェット自体は iOS が定期的に更新します（約30分後に更新してほしいと
// refreshAfterDate でお願いしていますが、更新のタイミングを決めるのは iOS で、
// 保証はされません）。
//
//
// 小サイズ：合計・目標までの残り（または達成／マイナス）・更新日時
// 中サイズ：小サイズの内容 ＋ 今日・今月・＋合計・－合計・進み具合バー
// 最終保存から1日以上たっていると、小／中どちらにも
// 「⚠ ○日以上前のデータです」の警告が出ます（古い合計だと気づかずに
// 見てしまうのを防ぐため）。
//
//
// アプリの書き出す setsuyaku-widget.json を読みます。
// { version:1, kind:"setsuyaku-widget", updatedAt:"...", total, today, month,
// plus, minus, goal}
// 旧形式の JSON 書き出し（summary 付き）もそのまま読めます。
// ファイルがない／読めない場合は、ウィジェット内に案内を表示します。
//
//
// このスクリプトは VM 上のスタブ検証のみで、iPhone 実機での動作は未検証です。
// Scriptable の API (FileManager.iCloud / ListWidget / config.widgetFamily 等)
// は公式ドキュメント (docs.scriptable.app) で裏取り済みです。

const WIDGET_FILE = 'setsuyaku-widget.json'

// ---------- 数値・表示の整形（純粋関数） ----------
function yen(n) {
const v = Math.round(Number(n) || 0)
const sign = v < 0? '-': ''
return sign + '¥' + Math.abs(v).toLocaleString('ja-JP')
}

function signedPct(total, goal) {
if (!goal || goal <= 0) return null
return Math.trunc((Number(total) || 0) / goal * 100)
}

function progressText(total, goal) {
const t = Number(total) || 0
const g = Number(goal) || 0
if (g <= 0) return '目標未設定'
if (t >= g) return '目標達成！'
if (t < 0) return 'マイナス ' + yen(Math.abs(t)) + '（あと ' + yen(g - t) + '）'
const p = signedPct(t, g)
return 'あと ' + yen(g - t) + '（' + (p > 0? '+': '') + p + '%）'
}

function progressBar(total, goal, cells) {
const t = Number(total) || 0
const g = Number(goal) || 0
if (g <= 0) return ''
const ratio = Math.max(0, Math.min(1, t / g))
const filled = Math.round(ratio * cells)
return '▓'.repeat(filled) + '░'.repeat(cells - filled)
}

function updatedText(updatedAt) {
if (!updatedAt) return ''
const d = new Date(updatedAt)
if (isNaN(d.getTime())) return ''
const mm = String(d.getMinutes()).padStart(2, '0')
return '更新 ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + mm
}

// 最終保存からの経過日数。updatedAt がない／読めないときは null。
// nowMs を渡せるのは検証用で、実機では Date.now() が使われる。
function staleDays(updatedAt, nowMs) {
if (!updatedAt) return null
const d = new Date(updatedAt)
if (isNaN(d.getTime())) return null
const now = typeof nowMs === 'number'? nowMs: Date.now()
const ageMs = now - d.getTime()
if (ageMs < 0) return 0
return Math.floor(ageMs / (24 * 60 * 60 * 1000))
}

// 1日以上たっていたら警告文、そうでなければ ''。
function staleText(updatedAt, nowMs) {
const days = staleDays(updatedAt, nowMs)
if (days === null || days < 1) return ''
return '⚠ ' + days + '日以上前のデータです'
}

// ---------- データの読み込み・正規化 ----------
// 書き出し形式（summary 付きの旧形式）とウィジェット用コンパクト形式の両対応。
function normalizeData(raw) {
if (!raw || typeof raw!== 'object') return null
const s = raw.summary && typeof raw.summary === 'object'? raw.summary: raw
const total = Number(s.total)
if (!isFinite(total)) return null
return {
total: total,
today: Number(s.today) || 0,
month: Number(s.month) || 0,
plus: Number(s.plus) || 0,
minus: Number(s.minus) || 0,
goal: Number(s.goal) || 0,
updatedAt: raw.updatedAt || s.updatedAt || '',
}
}

async function loadData(fm) {
const path = fm.joinPath(fm.documentsDirectory(), WIDGET_FILE)
if (!fm.fileExists(path)) return { status: 'missing'}
try {
await fm.downloadFileFromiCloud(path)
const text = fm.readString(path)
const data = normalizeData(JSON.parse(text))
if (!data) return { status: 'broken'}
return { status: 'ok', data: data}
} catch (e) {
return { status: 'broken'}
}
}

function pickFileManager() {
try {
return FileManager.iCloud()
} catch (e) {
return FileManager.local()
}
}

// ---------- ウィジェットの組み立て ----------
function addRow(widget, label, value, bold) {
const row = widget.addStack()
const l = row.addText(label)
l.font = Font.systemFont(13)
l.textColor = new Color('#5b6b60')
row.addSpacer()
const v = row.addText(value)
v.font = bold? Font.boldSystemFont(14): Font.systemFont(14)
v.textColor = new Color('#1c2a22')
}

function buildWidget(result, family) {
const widget = new ListWidget()
widget.backgroundColor = new Color('#ffffff')
widget.setPadding(14, 14, 14, 14)
// 約30分後の更新を iOS へお願いする（ヒントのみで、保証はされない）。
// タップでアプリを開けるようにし、再保存への導線にする。
widget.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000)
widget.url = 'https://tabearyoshi-hash.github.io/setsuyaku-chokin/?widget=1'

const title = widget.addText('💰 節約貯金')
title.font = Font.boldSystemFont(13)
title.textColor = new Color('#0f7a3d')

if (result.status!== 'ok') {
widget.addSpacer(6)
const msg = widget.addText(result.status === 'missing'
? 'まだデータがありません'
: 'ウィジェット用ファイルが読めませんでした')
msg.font = Font.boldSystemFont(15)
msg.textColor = new Color('#1c2a22')
widget.addSpacer(4)
const hint = widget.addText(result.status === 'missing'
? 'アプリの「ウィジェット用ファイルを保存」で iCloud Drive の Scriptable フォルダへ保存してください'
: 'アプリで「ウィジェット用ファイルを保存」を押し直してください')
hint.font = Font.systemFont(12)
hint.textColor = new Color('#5b6b60')
return widget
}

const d = result.data
const negative = d.total < 0

widget.addSpacer(2)
const total = widget.addText(yen(d.total))
total.font = Font.boldSystemFont(30)
total.textColor = new Color(negative? '#c0392b': '#0f7a3d')
total.minimumScaleFactor = 0.6

const prog = widget.addText(progressText(d.total, d.goal))
prog.font = Font.systemFont(13)
prog.textColor = new Color(negative? '#c0392b': '#1c2a22')

// 古いデータだと分かるように、1日以上たっていたら警告を出す（小／中共通）。
const stale = staleText(d.updatedAt)
if (stale) {
const s = widget.addText(stale)
s.font = Font.systemFont(12)
s.textColor = new Color('#b45309')
}

if (family!== 'small') {
widget.addSpacer(6)
const bar = progressBar(d.total, d.goal, 12)
const pct = signedPct(d.total, d.goal)
if (bar) {
const barText = widget.addText(bar + ' ' + (pct > 0? '+': '') + pct + '%')
barText.font = Font.systemFont(12)
barText.textColor = new Color('#5b6b60')
}
widget.addSpacer(6)
addRow(widget, '今日', yen(d.today))
addRow(widget, '今月', yen(d.month))
addRow(widget, '＋ 合計', yen(d.plus))
addRow(widget, '－ 合計', yen(Math.abs(d.minus)))
}

const upd = updatedText(d.updatedAt)
if (upd) {
widget.addSpacer()
const u = widget.addText(upd)
u.font = Font.systemFont(11)
u.textColor = new Color('#889')
}
return widget
}

// ---------- 実行 ----------
const fm = pickFileManager()
const result = await loadData(fm)
const family = (typeof config!== 'undefined' && config.widgetFamily)? config.widgetFamily: 'medium'
const widget = buildWidget(result, family)
if (typeof config!== 'undefined' && config.runsInWidget) {
Script.setWidget(widget)
} else if (family === 'small') {
await widget.presentSmall()
} else {
await widget.presentMedium()
}
Script.complete()
