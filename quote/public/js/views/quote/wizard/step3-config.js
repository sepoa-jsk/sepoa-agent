// STEP3 구성 — 작업 9 에서 구현한다.
// 현재는 진입만 가능하고 동작하지 않는다. 기존 경로(#/quotes/new-template)를 쓸 것.
import { h } from '../../../ui.js';

export function renderStep3(root, state) {
  root.replaceChildren();
  root.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', {}, 'STEP3 구성')),
    h('div', { class: 'card-b' },
      h('div', { class: 'banner wrn' },
        h('div', {},
          h('b', {}, '작업 9 에서 구현합니다'),
          '이 단계는 아직 동작하지 않습니다. 지금 견적을 작성하려면 사이드바의 ',
          h('b', { style: 'display:inline' }, '템플릿 견적'),
          ' 화면을 사용하세요.')))));
}
