import { config } from '../config';

type Tarefa = () => Promise<void>;

/** Fila em memória com concorrência limitada. */
class Fila {
  private pendentes: Tarefa[] = [];
  private rodando = 0;

  enfileirar(tarefa: Tarefa): void {
    this.pendentes.push(tarefa);
    this.puxar();
  }

  get tamanho(): number {
    return this.pendentes.length + this.rodando;
  }

  private puxar(): void {
    while (this.rodando < config.concorrencia && this.pendentes.length > 0) {
      const tarefa = this.pendentes.shift()!;
      this.rodando++;
      tarefa()
        .catch((e) => console.error('[fila] tarefa falhou:', e?.message))
        .finally(() => {
          this.rodando--;
          this.puxar();
        });
    }
  }
}

export const fila = new Fila();
