"use strict";
const speechButton = $("listen");
const speechStop = $("stop-voice");
const speechText = $("transcript");
const speechStatus = $("voice-status");
const speechResults = $("voice-results");
const phases = {idle:"待機中",starting:"マイクを準備中",listening:"聞き取り中",processing:"反映中",success:"反映完了",error:"入力を確認"};
function setAgentPhase(phase) {
  $("agent-stage").setAttribute("data-phase",phase);
  $("agent-phase").textContent = phases[phase];
  $("agent-panel-phase").textContent = phases[phase];
}
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const normalizeSpeech = text => text.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ja");
const newExample = "青葉デザイン株式会社の「デモ資料作成」を新規登録。期限は明日。内容は初稿をまとめる。";
const updateExample = "青葉デザイン株式会社の「見積書の確認」を完了にして。進捗メモは修正版を先方に送付済み。";

function speechDeadline(text, today) {
  const field = text.match(/(?:期限|締切|締め切り)(?:は|を|が|[:：、,])?\s*((?:\d{4}[年/.-])?\d{1,2}[月/.-]\d{1,2}日?|\d+日後|今日|本日|明後日|あさって|明日|あした)/u);
  if (!field) {
    if (/(?:期限|締切|締め切り)(?:は|を|が|[:：])/u.test(text)) throw new Error("期限は「明日」や「12月8日」のように指定してください。");
    return null;
  }
  const value = field[1];
  const offset = {"今日":0,"本日":0,"明日":1,"あした":1,"明後日":2,"あさって":2}[value];
  if (offset !== undefined) return shift(today, offset);
  if (/^\d+日後$/u.test(value)) {
    const days = Number.parseInt(value,10);
    if (days <= 3650) return shift(today,days);
    throw new Error("期限の日数を確認してください。");
  }
  const numbers = value.match(/\d+/g).map(Number);
  const [year,month,date] = numbers.length === 3 ? numbers : [Number(today.slice(0,4)),...numbers];
  const iso = [String(year).padStart(4,"0"),String(month).padStart(2,"0"),String(date).padStart(2,"0")].join("-");
  const parsed = new Date(iso+"T00:00:00Z");
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0,10)!==iso) throw new Error("指定された期限の日付を確認してください。");
  return iso;
}

function speechParts(text) {
  // Each new line marks a new instruction. Sentences on the same line can describe one case.
  return text.split(/[\n\r]+|(?:[。 、,]|^)*次の案件(?:です|は|として)?[。 、,]*/u).map(line => line.trim()).filter(Boolean);
}

function prepareSpeech(text, items, today) {
  const draft = items.map(item => ({...item,history:[...item.history]}));
  const output = [];
  for (const original of speechParts(text)) {
    const line = original.normalize("NFKC");
    const content = line.match(/(?:内容|詳細)(?:は|[:：])\s*([^。\n]+)/u)?.[1]?.trim();
    const memo = line.match(/(?:進捗メモ|更新メモ|メモ)(?:は|[:：])\s*([^。\n]+)/u)?.[1]?.trim();
    const command = line.replace(/(?:内容|詳細|進捗メモ|更新メモ|メモ)(?:は|[:：])[^。\n]*/gu,"");
    const normalized = normalizeSpeech(command);
    const deadline = speechDeadline(command,today);
    const quoted = command.match(/([^。、「」]+?)の[「『"“]([^」』"”]+)[」』"”]/u);
    const named = command.match(/企業名(?:は|[:：、,])\s*([^。、,]+)[。、,]\s*案件名(?:は|[:：、,])\s*([^。、,]+)/u);
    const spoken = command.match(/([\p{L}\p{N}ー・＆& ]+?(?:株式会社|合同会社|有限会社))の(.+?)を(?:新規登録|登録|追加)/u)
      || command.match(/((?:株式会社|合同会社|有限会社)[\p{L}\p{N}ー・＆& ]+?)の(.+?)を(?:新規登録|登録|追加)/u);
    const fields = quoted || named || spoken;
    const explicitCompany = fields?.[1]?.trim().replace(/^(?:それから|まずは|まず|えーと|では)[、, ]*/u,"");
    const explicitName = fields?.[2]?.trim();
    const companies = [...new Set(draft.map(item => item.company).filter(Boolean))];
    const companyMatches = companies.filter(name => normalized.includes(normalizeSpeech(name))).sort((a,b) => b.length-a.length);
    if (!explicitCompany && companyMatches.length>1) {
      throw new Error("複数の企業名が見つかりました。案件を分ける場合は「次の案件」と区切ってください。");
    }
    const company = explicitCompany || companyMatches[0] || "";
    const existingCompany = companies.find(name => normalizeSpeech(name)===normalizeSpeech(company));
    const openIntent = /未完了(?:に|へ|です|のまま|。|$)|完了を取り消|再開して/u.test(command);
    const doneIntent = !openIntent && !/まだ完了|完了していない|完了しない/u.test(command) && /(?<!未)完了(?:に|へ|しました|した|です|して|。|$)|対応済み/u.test(command);
    const create = /新規登録|新規案件|(?:を|で)(?:登録|追加)|(?:登録|追加)(?:して|してください|。|$)/u.test(command);
    const candidates = draft.filter(item =>
      (!company || normalizeSpeech(item.company || "")===normalizeSpeech(company)) &&
      (explicitName ? normalizeSpeech(item.name)===normalizeSpeech(explicitName) : normalized.includes(normalizeSpeech(item.name))));
    // Preserve the case ID on updates. Refuse ambiguous mentions before touching storage.
    if (candidates.length>1) throw new Error("対象案件を一つに絞れません。企業名と案件名をもう一度指定してください。");
    const current = candidates[0];
    if (create && !current) {
      if (!company || !explicitName || !deadline) throw new Error("新規登録には企業名、案件名、期限が必要です。発話例をご確認ください。");
      if (deadline<today) throw new Error("新規案件の期限は、今日以降を指定してください。");
      draft.unshift({id:crypto.randomUUID(),company:existingCompany || company,name:explicitName,
        description:content || memo || "音声で登録",created:today,deadline,done:doneIntent,updated:Date.now(),
        history:[{at:Date.now(),text:"ジャービスで案件を登録"+(memo?"\n"+memo:"")}]});
      output.push((existingCompany || company)+" / "+explicitName+" を登録しました。");
      continue;
    }
    if (!current) throw new Error("更新対象の案件が見つかりません。企業名と登録済みの案件名を指定してください。");
    const implicitMemo = !content && !memo && !deadline && !openIntent && !doneIntent && /更新|進捗|報告/u.test(command) ? original : "";
    if (!deadline && !content && !memo && !implicitMemo && !openIntent && !doneIntent) {
      throw new Error(create ? "同じ企業・案件名の案件がすでにあります。" : "期限、完了・未完了、または進捗メモを指定してください。");
    }
    if (deadline && deadline<current.created) throw new Error("期限は対象案件の入力日以降を指定してください。");
    const changes = ["ジャービスで更新"];
    if (deadline) { current.deadline=deadline; changes.push("期限 "+deadline); }
    if (content) { current.description=content; changes.push("案件内容を更新"); }
    if (openIntent || doneIntent) { current.done=doneIntent; changes.push(doneIntent?"完了に変更":"未完了に変更"); }
    if (memo || implicitMemo) changes.push(memo || implicitMemo);
    current.updated=Date.now();
    current.history.unshift({at:current.updated,text:changes.join("\n")});
    output.push(companyOf(current)+" / "+current.name+" を更新しました。");
  }
  if (!output.length) throw new Error("案件の内容を入力してください。");
  return {items:draft,output};
}

function applyTranscript() {
  try {
    const result = prepareSpeech(speechText.value,board.items,currentDay());
    board.items = result.items;
    persist();
    $("company-filter").value = "";
    $("filter").value = "all";
    $("search").value = "";
    $("sort").value = "updated";
    render();
    speechResults.replaceChildren(...result.output.map(message => el("li",message)));
    speechResults.hidden = false;
    setAgentPhase("success");
    speechStatus.textContent = result.output.length+"件の指示をボードに反映しました。";
  } catch (error) {
    speechResults.hidden = true;
    setAgentPhase("error");
    speechStatus.textContent = error.message+" 入力欄で直して再試行できます。";
  }
}

let recording = false;
$("apply-voice").onclick = applyTranscript;
$("clear-voice").onclick = () => {
  speechText.value = "";
  speechResults.hidden = true;
  setAgentPhase("idle");
  speechStatus.textContent = "入力をクリアしました。";
  speechText.focus();
};
for (const [id,example] of [["voice-new-example",newExample],["voice-update-example",updateExample]]) {
  $(id).onclick = () => {
    speechText.value = example;
    speechResults.hidden = true;
    setAgentPhase("idle");
    speechStatus.textContent = "発話例を入力しました。「テキストを反映」で試せます。";
    speechText.focus();
  };
}
$("agent-mic-status").textContent = SpeechRecognition ? "使用可能" : "テキスト入力のみ";
if (!SpeechRecognition) {
  speechButton.disabled = true;
  speechStatus.textContent = "このブラウザでは音声認識を利用できません。テキスト入力か発話例でお試しください。";
} else {
  const recognition = new SpeechRecognition();
  recognition.lang = "ja-JP";
  recognition.continuous = true;
  recognition.interimResults = true;
  let failed = false;
  let finalText = "";
  function setRecording(active) {
    recording = active;
    speechButton.disabled = active;
    speechStop.disabled = !active;
    for (const id of ["clear-voice","apply-voice","voice-new-example","voice-update-example"]) $(id).disabled = active;
    speechText.readOnly = active;

  }
  speechButton.onclick = () => {
    failed=false;
    finalText="";
    speechText.value="";
    speechResults.hidden=true;
    setRecording(true);
    setAgentPhase("starting");
    speechStatus.textContent="マイクを準備しています…";
    try { recognition.start(); }
    catch { setRecording(false); setAgentPhase("error"); speechStatus.textContent="音声認識を開始できませんでした。テキスト入力をお試しください。"; }
  };
  recognition.onstart = () => {
    if (speechStop.disabled) return;
    setAgentPhase("listening");
    speechStatus.textContent="聞き取り中です。話し終えたら「録音終了・反映」を押してください。";
  };
  recognition.onresult = event => {
    let interim = "";
    for (let index=event.resultIndex;index<event.results.length;index++) {
      const result = event.results[index];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    speechText.value=finalText+interim;
  };
  recognition.onerror = event => {
    failed=true;
    setAgentPhase("error");
    speechStatus.textContent=event.error==="not-allowed" ? "マイクへのアクセスが拒否されました。ブラウザの許可設定またはテキスト入力をお試しください。" : "音声認識が中断されました。入力欄に残った内容を編集して反映できます。";
  };
  recognition.onend = () => {
    setRecording(false);
    if (failed) return;
    if (finalText.trim()) { speechText.value=finalText; applyTranscript(); }
    else {
      setAgentPhase("error");
      speechStatus.textContent="音声を聞き取れませんでした。もう一度話すか、テキストで入力してください。";
    }
  };
  speechStop.onclick = () => {
    if (!recording) return;
    speechStop.disabled=true;
    setAgentPhase("processing");
    speechStatus.textContent="聞き取った内容を処理しています…";
    recognition.stop();
  };
}
