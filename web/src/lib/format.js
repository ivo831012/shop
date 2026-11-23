const nf2 = new Intl.NumberFormat('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfq = new Intl.NumberFormat('bg-BG', { maximumFractionDigits: 3 });
export const eur = (v) => `${nf2.format(Number(v) || 0)} €`;
export const money = (v) => nf2.format(Number(v) || 0);
export const qty = (v) => nfq.format(Number(v) || 0);
export const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
export const parseNum = (s) => {
  const n = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
export const dec = (v) => String(v ?? '').replace('.', ',');
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const fmtDate = (s) => (s ? new Date(s.length === 10 ? s : s.replace(' ', 'T') + 'Z').toLocaleDateString('bg-BG') : '');
export const fmtTime = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' }) : '');
export const today = () => new Date().toLocaleDateString('sv-SE');

export const ROLE = { admin: 'Администратор', manager: 'Управител', cashier: 'Касиер', stock: 'Склад' };
export const TYPE = { goods: 'Стока', recipe: 'Рецепта', combo: 'Комбо меню', service: 'Услуга' };
export const VAT = { А: 0, Б: 20, В: 20, Г: 9 };
export const COLORS = ['latte', 'sage', 'wheat', 'rose', 'slate', 'stone', 'clay', 'moss', 'plum', 'sky'];
export const catColor = (c) => `var(--cat-${c || 'stone'})`;
