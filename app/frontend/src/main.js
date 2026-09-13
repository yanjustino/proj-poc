import './style.css';
import './app.css';

import logo from './assets/images/logo-universal.png';
import {PingMHL} from '../wailsjs/go/main/App';

// Fase 0 spike only: proves the Go shell can spawn `mhl serve mcp --http`,
// talk MCP to it, and surface the result through a bound method to the
// frontend. Fase 6 replaces this with the real UI (work-item list, wiki,
// artifact generation/progress).
document.querySelector('#app').innerHTML = `
    <img id="logo" class="logo">
      <div class="result" id="result">Clique para testar a ponte com o mhl 👇</div>
      <div class="input-box" id="input">
        <button class="btn" onclick="pingMHL()">Ping MHL</button>
      </div>
    </div>
`;
document.getElementById('logo').src = logo;

let resultElement = document.getElementById("result");

window.pingMHL = function () {
    resultElement.innerText = "chamando mhl...";
    PingMHL()
        .then((result) => {
            resultElement.innerText = result;
        })
        .catch((err) => {
            resultElement.innerText = "erro: " + err;
            console.error(err);
        });
};
