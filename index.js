import {
  supabase,
  getCart,
  saveCart,
  formatQuantity,
  formatQuantityDisplay,
  quantityInputHtml,
  parseQuantityForItem,
  escapeHtml,
} from './shared.js';

const noticeArea = document.getElementById('notice-area');
const volunteerList = document.getElementById('volunteer-list');
const materialList = document.getElementById('material-list');
const donationList = document.getElementById('donation-list');
const stickyCart = document.getElementById('sticky-cart');
const cartCount = document.getElementById('cart-count');

function notice(msg, kind = 'error') {
  noticeArea.innerHTML = `<div class="notice ${kind}">${escapeHtml(msg)}</div>`;
}

function refreshStickyCart() {
  const cart = getCart();
  const n = Object.keys(cart).length;
  if (n === 0) {
    stickyCart.classList.add('hidden');
    return;
  }
  stickyCart.classList.remove('hidden');
  cartCount.textContent = `${n} item${n === 1 ? '' : 's'} selected for sign-up`;
}

function itemCardHtml(item) {
  const fulfilled = item.is_fulfilled;
  const committed = Number(item.committed_quantity) || 0;
  const thankyous = (item.thankyous || []).filter((t) => t && t.name);

  let statusLine = '';
  if (item.target_quantity != null) {
    const remaining = Math.max(0, item.target_quantity - committed);
    statusLine = fulfilled
      ? `Fully covered — thank you!`
      : `${formatQuantityDisplay(committed, item.unit)} of ${formatQuantityDisplay(item.target_quantity, item.unit)} covered (${formatQuantityDisplay(remaining, item.unit)} more needed)`;
  } else if (committed > 0) {
    statusLine = `${formatQuantityDisplay(committed, item.unit)} committed so far`;
  }

  const thankyouHtml = thankyous.length
    ? `<div class="thankyou">THANK YOU: ${thankyous
        .map((t) => `${escapeHtml(t.name)} (${formatQuantityDisplay(t.quantity, item.unit)})`)
        .join(', ')}</div>`
    : '';

  const cart = getCart();
  const inCart = cart[item.id];

  return `
  <div class="card item-card" data-item-id="${item.id}">
    <div class="item-head">
      <div class="item-name${fulfilled ? ' fulfilled' : ''}">${escapeHtml(item.name)}</div>
    </div>
    ${item.description ? `<div class="item-desc">${escapeHtml(item.description)}</div>` : ''}
    ${statusLine ? `<div class="item-status${fulfilled ? ' fulfilled' : ''}">${statusLine}</div>` : ''}
    ${thankyouHtml}
    <div class="add-row">
      ${
        inCart
          ? `<span class="pill approved">In your list: ${formatQuantityDisplay(inCart.quantity, item.unit)}</span>
             <button type="button" class="secondary small" data-action="edit">Edit</button>
             <button type="button" class="secondary small" data-action="remove">Remove</button>`
          : `<button type="button" class="small" data-action="add">I can help with this</button>`
      }
    </div>
    <div class="qty-form hidden">
      <div class="row">
        ${quantityInputHtml(item, 'qty-input', inCart ? inCart.quantity : '')}
        <button type="button" class="small" data-action="confirm">Save</button>
        <button type="button" class="secondary small" data-action="cancel">Cancel</button>
      </div>
    </div>
  </div>`;
}

function wireCard(el, item) {
  const addBtn = el.querySelector('[data-action="add"]');
  const editBtn = el.querySelector('[data-action="edit"]');
  const removeBtn = el.querySelector('[data-action="remove"]');
  const qtyForm = el.querySelector('.qty-form');
  const qtyInput = el.querySelector('.qty-input');
  const confirmBtn = el.querySelector('[data-action="confirm"]');
  const cancelBtn = el.querySelector('[data-action="cancel"]');

  const openForm = () => {
    qtyForm.classList.remove('hidden');
    qtyInput.focus();
  };

  addBtn?.addEventListener('click', openForm);
  editBtn?.addEventListener('click', openForm);
  cancelBtn?.addEventListener('click', () => qtyForm.classList.add('hidden'));

  removeBtn?.addEventListener('click', () => {
    const cart = getCart();
    delete cart[item.id];
    saveCart(cart);
    render();
  });

  confirmBtn?.addEventListener('click', () => {
    const qty = parseQuantityForItem(item, qtyInput.value);
    if (!Number.isFinite(qty) || qty <= 0) {
      notice('Please enter a valid quantity.');
      return;
    }
    if (item.unit === '%' && qty > 100) {
      notice('Percentage can\'t be more than 100.');
      return;
    }
    const cart = getCart();
    cart[item.id] = {
      quantity: qty,
      name: item.name,
      category: item.category,
      unit: item.unit || '',
    };
    saveCart(cart);
    noticeArea.innerHTML = '';
    render();
  });
}

let allItems = [];

function render() {
  const volunteers = allItems.filter((i) => i.category === 'volunteer');
  const materials = allItems.filter((i) => i.category === 'material');
  const donations = allItems.filter((i) => i.category === 'donation');

  volunteerList.innerHTML = volunteers.map(itemCardHtml).join('') || '<p class="intro">Nothing here yet.</p>';
  materialList.innerHTML = materials.map(itemCardHtml).join('') || '<p class="intro">Nothing here yet.</p>';
  donationList.innerHTML = donations.map(itemCardHtml).join('') || '<p class="intro">Nothing here yet.</p>';

  [...volunteerList.children, ...materialList.children, ...donationList.children].forEach((el) => {
    const item = allItems.find((i) => i.id === el.dataset.itemId);
    if (item) wireCard(el, item);
  });

  refreshStickyCart();
}

async function load() {
  const { data, error } = await supabase.rpc('get_wishlist');
  if (error) {
    notice('Could not load the wish list: ' + error.message);
    return;
  }
  allItems = data || [];
  render();
}

load();
