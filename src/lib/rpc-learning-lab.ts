// A reviewed, opt-in RPC learning lab: author cards, practise answers, and attach media on a phone.
export const RPC_LEARNING_LAB_SERVER = `import { DurableObject } from 'cloudflare:workers';
export class Gadget extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS cards(id TEXT PRIMARY KEY, title TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, explanation TEXT NOT NULL, media TEXT NOT NULL DEFAULT "")');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS practice(id TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL DEFAULT 0)');
    ctx.storage.sql.exec('INSERT OR IGNORE INTO cards(id,title,question,answer,explanation) VALUES(?,?,?,?,?)', 'first-card', 'Your first TypeScript card', 'What does a type annotation describe?', 'a value', 'A type annotation describes the kind of value a variable, parameter, or result can hold.');
  }
  healthCheck() { return true; }
  async listCards() {
    const cards = this.ctx.storage.sql.exec('SELECT id,title,question,answer,explanation,media FROM cards ORDER BY rowid').toArray();
    return cards.map(card => ({ ...card, attempts: this.ctx.storage.sql.exec('SELECT attempts FROM practice WHERE id=?',card.id).toArray()[0]?.attempts ?? 0 }));
  }
  async saveCard(input) {
    if (!input || typeof input !== 'object') throw new Error('Card details required');
    const fields = ['title','question','answer','explanation'];
    for (const field of fields) if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 2000) throw new Error('Complete each card field (up to 2000 characters)');
    const id = typeof input.id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(input.id) ? input.id : crypto.randomUUID();
    this.ctx.storage.sql.exec('INSERT INTO cards(id,title,question,answer,explanation) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,question=excluded.question,answer=excluded.answer,explanation=excluded.explanation', id, ...fields.map(field => input[field].trim()));
    return id;
  }
  async deleteCard(id) {
    if (typeof id !== 'string') throw new Error('Card ID required');
    const record = this.ctx.storage.sql.exec('SELECT media FROM cards WHERE id=?',id).toArray()[0];
    if (!record) throw new Error('Card not found');
    this.ctx.storage.sql.exec('DELETE FROM cards WHERE id=?',id);
    this.ctx.storage.sql.exec('DELETE FROM practice WHERE id=?',id);
    if (record.media) await this.env.MEDIA.delete(record.media);
    return true;
  }
  async checkAnswer(id, answer) {
    if (typeof answer !== 'string' || answer.length > 1000) throw new Error('Answer is too long');
    const card = this.ctx.storage.sql.exec('SELECT answer,explanation FROM cards WHERE id=?',id).toArray()[0];
    if (!card) throw new Error('Card not found');
    const correct = answer.trim().toLowerCase() === card.answer.trim().toLowerCase();
    this.ctx.storage.sql.exec('INSERT INTO practice(id,attempts,correct) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1,correct=correct+excluded.correct',id,correct ? 1 : 0);
    const attempts = this.ctx.storage.sql.exec('SELECT attempts FROM practice WHERE id=?',id).toArray()[0].attempts;
    return { correct, attempts, explanation: card.explanation };
  }
  async putMedia(id, name, type, bytes) {
    const record = this.ctx.storage.sql.exec('SELECT media FROM cards WHERE id=?',id).toArray()[0];
    if (!record) throw new Error('Card not found');
    if (typeof type !== 'string' || !/^(image|audio|video)\\//.test(type)) throw new Error('Choose an image, audio or video file');
    const asset = await this.env.MEDIA.put({ name, contentType: type, bytes });
    this.ctx.storage.sql.exec('UPDATE cards SET media=? WHERE id=?',asset.id,id);
    if (record.media) await this.env.MEDIA.delete(record.media);
    return asset;
  }
  async getMedia(id) {
    const record = this.ctx.storage.sql.exec('SELECT media FROM cards WHERE id=?',id).toArray()[0];
    return record?.media ? this.env.MEDIA.get(record.media) : null;
  }
}`;

export const RPC_LEARNING_LAB_CLIENT = `export default { async main(gadget) {
  const style = document.createElement('style');
  style.textContent = 'body{margin:0;background:#f7f9f5;color:#182822;font:16px system-ui;padding:16px}main{max-width:680px;margin:auto}h1{font-size:1.6rem}h2{font-size:1.15rem}section{background:white;border:1px solid #d7e2d7;border-radius:14px;padding:18px;margin:14px 0}label{display:block;margin:12px 0;font-weight:600}input,textarea{display:block;width:100%;box-sizing:border-box;padding:12px;font:16px system-ui;border:1px solid #a5b7a5;border-radius:8px;margin-top:5px}button{padding:12px 16px;min-height:44px;border:0;border-radius:8px;background:#245d4a;color:white;font:600 16px system-ui;margin:5px 8px 5px 0}button.secondary{background:#e5eee9;color:#1a4436}button.danger{background:#a33a32}img,video{max-width:100%;border-radius:8px}small{color:#52625b}.feedback{padding:10px;background:#e8f4eb;border-radius:8px}.row{display:flex;flex-wrap:wrap;gap:8px}';
  document.head.append(style);
  const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
  const root = el('main'); document.body.append(root);
  root.append(el('h1','Learning lab'), el('p','Create a short card, try its question, and save your progress here.'));
  const message = el('p'); message.setAttribute('role','status'); root.append(message);
  const editor = el('section'); editor.append(el('h2','Add or edit a card')); root.append(editor);
  const inputs = {};
  for (const [key,label] of [['title','Card title'],['question','Practice question'],['answer','Expected answer'],['explanation','Explanation after checking']]) {
    const wrapper = el('label',label); const input = el(key === 'explanation' ? 'textarea' : 'input'); input.name = key; input.maxLength = 2000; wrapper.append(input); editor.append(wrapper); inputs[key] = input;
  }
  const save = el('button','Save card'); editor.append(save);
  const cancel = el('button','Clear editor'); cancel.className = 'secondary'; cancel.type = 'button'; editor.append(cancel);
  const list = el('div'); root.append(list); let editing = '';
  const clear = () => { editing = ''; for (const input of Object.values(inputs)) input.value = ''; save.textContent = 'Save card'; };
  cancel.onclick = clear;
  save.onclick = async () => {
    save.disabled = true; message.textContent = 'Saving…';
    try { await gadget.saveCard({ id: editing || undefined, title: inputs.title.value, question: inputs.question.value, answer: inputs.answer.value, explanation: inputs.explanation.value }); clear(); message.textContent = 'Card saved.'; await refresh(); }
    catch { message.textContent = 'Could not save. Check each field and try again.'; }
    finally { save.disabled = false; }
  };
  async function refresh() {
    const cards = await gadget.listCards(); list.replaceChildren();
    if (!cards.length) { list.append(el('p','No cards yet. Add one above.')); return; }
    for (const card of cards) {
      const section = el('section'); section.append(el('h2',card.title),el('p',card.question),el('small','Attempts: '+card.attempts));
      const answer = el('input'); answer.setAttribute('aria-label','Your answer for '+card.title); answer.placeholder = 'Type an answer'; section.append(answer);
      const feedback = el('p'); feedback.className = 'feedback'; feedback.setAttribute('role','status');
      const check = el('button','Check answer'); check.onclick = async () => {
        check.disabled = true; feedback.textContent = 'Checking…';
        try { const result = await gadget.checkAnswer(card.id,answer.value); feedback.textContent = (result.correct ? 'Correct! ' : 'Not quite. ') + result.explanation + ' · Attempts: ' + result.attempts; }
        catch { feedback.textContent = 'Could not check the answer.'; }
        finally { check.disabled = false; }
      };
      section.append(check,feedback);
      const edit = el('button','Edit'); edit.className = 'secondary'; edit.onclick = () => { editing = card.id; for (const key of Object.keys(inputs)) inputs[key].value = card[key]; save.textContent = 'Update card'; editor.scrollIntoView({ behavior: 'smooth' }); };
      const remove = el('button','Delete'); remove.className = 'danger'; remove.onclick = async () => { if (remove.dataset.confirm !== 'yes') { remove.dataset.confirm = 'yes'; remove.textContent = 'Tap again to delete'; return; } try { await gadget.deleteCard(card.id); message.textContent = 'Card deleted.'; await refresh(); } catch { message.textContent = 'Could not delete this card.'; } };
      section.append(edit,remove);
      const upload = el('input'); upload.type = 'file'; upload.accept = 'image/*,audio/*,video/*'; upload.setAttribute('aria-label','Add media to '+card.title);
      upload.onchange = async () => { const file = upload.files?.[0]; if (!file) return; if (file.size > 25*1024*1024) { message.textContent = 'Choose a file under 25 MB.'; return; } try { await gadget.putMedia(card.id,file.name,file.type,await file.arrayBuffer()); message.textContent = 'Media saved.'; await refresh(); } catch { message.textContent = 'Could not save media.'; } };
      section.append(upload);
      if (card.media) {
        try { const asset = await gadget.getMedia(card.id); if (asset) {
          const url = URL.createObjectURL(new Blob([asset.bytes], {type: asset.type}));
          const preview = el(asset.type.startsWith('image/') ? 'img' : asset.type.startsWith('audio/') ? 'audio' : 'video'); preview.src = url; preview.alt = asset.name;
          if (preview.tagName !== 'IMG') preview.controls = true;
          section.append(preview);
        } } catch { section.append(el('small','Media unavailable.')); }
      }
      list.append(section);
    }
  }
  await refresh();
} };`;

export const RPC_LEARNING_LAB_TESTS = [
  { method: "saveCard", args: [{ id: "preflight", title: "Example", question: "What is a variable?", answer: "a named value", explanation: "It gives a value a name." }], expect: "preflight" },
  { method: "checkAnswer", args: ["preflight", "a named value"], expect: { correct: true, attempts: 1, explanation: "It gives a value a name." } },
];
