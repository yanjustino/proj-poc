const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.site-nav');

menuButton.addEventListener('click', () => {
  const expanded = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!expanded));
  menuButton.setAttribute('aria-label', expanded ? 'Abrir menu' : 'Fechar menu');
  navigation.classList.toggle('is-open', !expanded);
});

navigation.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
  navigation.classList.remove('is-open');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Abrir menu');
}));

const dialog = document.querySelector('.image-dialog');
const dialogImage = dialog.querySelector('img');
const dialogCaption = dialog.querySelector('p');

document.querySelectorAll('.shot-button').forEach((button) => button.addEventListener('click', () => {
  dialogImage.src = button.dataset.image;
  dialogImage.alt = button.querySelector('img').alt;
  dialogCaption.textContent = button.dataset.caption;
  dialog.showModal();
}));

dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => { dialogImage.removeAttribute('src'); });
