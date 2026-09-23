import React from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './index.module.css';

export default function Home() {
  const logo = useBaseUrl('/img/senpai-logo-dark.png');

  return (
    <Layout
      title="Refiner"
      description="Documentação do Senpai Refiner"
      noFooter
      wrapperClassName={styles.layout}
    >
      <main className={styles.home}>
        <div className={styles.center}>
          <img className={styles.logo} src={logo} alt="Senpai Refiner" />
          <p className={styles.tagline}>Refine contexto. Decida melhor. Entregue com clareza.</p>
          <Link className={styles.link} to="/docs/intro">
            Abrir documentação <span aria-hidden="true">→</span>
          </Link>
        </div>
      </main>
    </Layout>
  );
}
