import React, {useState} from 'react';
import styles from './styles.module.css';

const screens = [
  {id: 'fontes', label: 'Fontes'},
  {id: 'wiki', label: 'Wiki'},
  {id: 'artefatos', label: 'Artefatos'},
  {id: 'revisao', label: 'Revisão'},
];

const artifacts = [
  ['Brief', 'done', 'Discovery'],
  ['Atributos de qualidade', 'done', 'Discovery'],
  ['Requisitos', 'active', 'Discovery'],
  ['Decisões de arquitetura', 'ready', 'Decisões'],
  ['Diagramas', 'locked', 'Modelos'],
  ['Features', 'locked', 'Entrega'],
];

function Brand() {
  return (
    <div className={styles.brand}>
      <span className={styles.brandMark}>先</span>
      <span><b>Senpai</b><small>Refiner</small></span>
    </div>
  );
}

function Sidebar({screen}) {
  return (
    <aside className={styles.sidebar}>
      <Brand />
      <div className={styles.search}>⌕&nbsp;&nbsp;Buscar work-item…</div>
      <div className={styles.navLabel}>Work-items</div>
      <div className={styles.workItemActive}><span>◈</span><span><b>Checkout inteligente</b><small>Discovery</small></span></div>
      <div className={styles.workItem}><span>◇</span><span><b>Cadastro simplificado</b><small>Delivery</small></span></div>
      <div className={styles.workItem}><span>◇</span><span><b>Alertas de fraude</b><small>Delivery</small></span></div>
      <div className={styles.sidebarBottom}>
        <span className={styles.greenDot} /> mhl conectado
        <small>Visualização: {screen}</small>
      </div>
    </aside>
  );
}

function Top({active}) {
  return (
    <>
      <div className={styles.pageTitle}>
        <div><small>Oportunidade · Discovery</small><h3>Checkout inteligente</h3></div>
        <span className={styles.more}>•••</span>
      </div>
      <div className={styles.metrics}>
        <span><b>3</b><small>fontes</small></span>
        <span><b>2 de 8</b><small>artefatos</small></span>
        <span><b>24,8k</b><small>tokens</small></span>
      </div>
      <nav className={styles.appTabs} aria-label="Seções simuladas">
        {screens.slice(0, 3).map((tab) => <span key={tab.id} className={active === tab.id ? styles.appTabActive : ''}>{tab.label}</span>)}
        <span>Logs</span>
      </nav>
    </>
  );
}

function Sources() {
  return (
    <>
      <div className={styles.panelHead}><div><b>Fontes do contexto</b><small>Documentos usados para construir a wiki</small></div><button>＋ Adicionar</button></div>
      <div className={styles.sourceList}>
        <div className={styles.sourceSelected}><span className={styles.fileIcon}>MD</span><span><b>visao-produto.md</b><small>12 KB · ingerida</small></span><i>✓</i></div>
        <div><span className={styles.fileIcon}>PDF</span><span><b>entrevistas-clientes.pdf</b><small>2,4 MB · ingerida</small></span><i>✓</i></div>
        <div><span className={styles.fileIcon}>TXT</span><span><b>metricas-checkout.txt</b><small>8 KB · aguardando</small></span><i className={styles.pendingDot}>●</i></div>
      </div>
      <div className={styles.callout}><span>↻</span><div><b>Contexto incremental</b><small>Novas fontes enriquecem a wiki sem apagar o conhecimento já revisado.</small></div><button>Ingerir pendentes</button></div>
    </>
  );
}

function Wiki() {
  return (
    <>
      <div className={styles.panelHead}><div><b>Wiki do work-item</b><small>Conhecimento extraído e rastreável</small></div><button>Fazer pergunta</button></div>
      <div className={styles.pills}><span className={styles.pillActive}>Fontes</span><span>Entidades</span><span>Conceitos</span><span>Respostas</span></div>
      <div className={styles.wikiGrid}>
        <div><small>ENTIDADE</small><b>Cliente recorrente</b><p>Usuário com compra anterior e dados válidos no perfil.</p><span>2 fontes</span></div>
        <div><small>CONCEITO</small><b>Checkout expresso</b><p>Fluxo reduzido que reutiliza dados previamente validados.</p><span>3 fontes</span></div>
        <div><small>REGRA</small><b>Validação antifraude</b><p>A análise de risco acontece antes da confirmação do pedido.</p><span>1 fonte</span></div>
        <div><small>GAP</small><b>Fallback de pagamento</b><p>O comportamento para indisponibilidade ainda não foi definido.</p><span className={styles.warn}>revisar</span></div>
      </div>
    </>
  );
}

function Artifacts() {
  return (
    <>
      <div className={styles.panelHead}><div><b>Mapa de artefatos</b><small>Gere documentos respeitando suas dependências</small></div><button>Exportar tudo</button></div>
      <div className={styles.pills}><span className={styles.pillActive}>Todos</span><span>Prontos</span><span>Pendentes</span></div>
      <div className={styles.artifactGrid}>
        {artifacts.map(([name, state, group]) => (
          <div key={name} className={`${styles.artifactCard} ${state === 'active' ? styles.artifactActive : ''}`}>
            <small>{group}</small><b>{name}</b>
            <span className={styles.artifactStatus} data-state={state}>
              {state === 'done' ? '● Pronto' : state === 'active' ? '● Gerando' : state === 'ready' ? '○ Disponível' : '◇ Aguardando dependências'}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function Review() {
  return (
    <>
      <div className={styles.reviewStatus}><span className={styles.pulse} /> Artefato gerado · aguardando sua revisão</div>
      <article className={styles.reviewCard}>
        <small>REQUISITOS · VERSÃO PROPOSTA</small>
        <h4>Requisitos do checkout inteligente</h4>
        <p>O sistema deve permitir que clientes recorrentes confirmem seus dados antes de concluir a compra.</p>
        <h5>Critérios verificáveis</h5>
        <ul><li>Exibir endereço e forma de pagamento selecionados.</li><li>Solicitar nova validação quando os dados estiverem expirados.</li></ul>
        <div className={styles.sourceRef}>Fonte: visao-produto.md · seção “Jornada proposta”</div>
      </article>
      <div className={styles.reviewActions}><button className={styles.feedback}>Solicitar alterações</button><button className={styles.approve}>Aprovar e salvar</button></div>
    </>
  );
}

function ReadingPane({screen}) {
  const content = {
    fontes: <><small>FONTE SELECIONADA</small><h4>Visão do produto</h4><p>Reduzir o atrito no checkout para clientes que já possuem endereço e pagamento validados.</p><div className={styles.rule} /><b>Resultado esperado</b><p>Aumentar a conversão sem reduzir os controles de risco.</p></>,
    wiki: <><small>CONCEITO</small><h4>Checkout expresso</h4><p>Fluxo de compra com reutilização de dados, confirmação explícita e validação de risco.</p><div className={styles.refBox}>↗ visao-produto.md<br />↗ entrevistas-clientes.pdf<br />↗ metricas-checkout.txt</div></>,
    artefatos: <><small>GERAÇÃO EM ANDAMENTO</small><h4>Requisitos</h4><div className={styles.progress}><i /></div><p>Estruturando requisitos funcionais e não funcionais a partir da wiki…</p><div className={styles.stepDone}>✓ Contexto validado</div><div className={styles.stepDone}>✓ Fontes selecionadas</div><div className={styles.stepCurrent}>↻ Gerando documento</div></>,
    revisao: <><small>ALTERAÇÕES</small><h4>Oriente a próxima versão</h4><p>Descreva o que deve ser ajustado. O Senpai preserva o contexto da rodada atual.</p><div className={styles.fakeInput}>Inclua um requisito para recuperação após falha…</div><button className={styles.send}>Enviar orientação</button></>,
  };
  return <aside className={styles.reading}>{content[screen]}</aside>;
}

export function AppMockup({screen = 'artefatos', compact = false}) {
  const active = screen === 'revisao' ? 'artefatos' : screen;
  return (
    <div className={`${styles.frame} ${compact ? styles.compact : ''}`} role="img" aria-label={`Simulação da tela de ${screen} do Senpai`}>
      <div className={styles.windowBar}><i /><i /><i /><span>Senpai Refiner</span></div>
      <div className={styles.app}>
        <Sidebar screen={screen} />
        <main className={styles.content}>
          <Top active={active} />
          <div className={styles.screenBody}>{screen === 'fontes' ? <Sources /> : screen === 'wiki' ? <Wiki /> : screen === 'revisao' ? <Review /> : <Artifacts />}</div>
        </main>
        <ReadingPane screen={screen} />
      </div>
    </div>
  );
}

export default function ProductTour({initial = 'artefatos'}) {
  const [screen, setScreen] = useState(initial);
  return (
    <section className={styles.tour}>
      <div className={styles.tourNav} role="tablist" aria-label="Simulações do Senpai">
        {screens.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={screen === item.id} onClick={() => setScreen(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <AppMockup screen={screen} />
      <p className={styles.caption}>Simulação ilustrativa — os dados exibidos são fictícios.</p>
    </section>
  );
}
