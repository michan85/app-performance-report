import childProcess, { ChildProcess } from 'child_process'
import { Log, chart, parseShellOutput, parseBytes, sum } from './utils'
import { strict as assert } from 'assert'

export interface NetStat extends Sample {
  rx: number
  tx: number
}
export interface ProcStat extends Sample {
  cpu: number
  mem: number
}

export enum DataType {
  bytes = 'bytes',
  value = 'value',
}

export interface MetricData<T = any> {
  name: string
  metric: string
  samples: T[]
  dataSets: Dataset[]
}

export interface Dataset {
  name: string
  data: number[] | Array<{ tick: number; value: number }>
  dataType: DataType
}

export type OutputProcessor<T extends Sample> = (
  line: string,
  metricCollector: MetricCollector<T>,
) => void

export interface Sample {
  tick: number
}

export class MetricCollector<T extends Sample> {
  cmd: string
  outputProcessor?: OutputProcessor<T>
  process?: ChildProcess

  name: string
  metric: string
  currentValue: T = {} as T
  samples: T[] = []

  constructor({
    name,
    metric,
    cmd,
    outputProcessor,
  }: {
    metric: string
    cmd: string
    name?: string
    outputProcessor?: OutputProcessor<T>
  }) {
    this.name = name || metric
    this.metric = metric
    this.cmd = cmd
    this.outputProcessor = outputProcessor
    this.reset()
  }
  reset() {
    this.currentValue = this.initialValue()
  }
  initialValue() {
    return {} as T
  }
  startTime?: number

  get tick() {
    const now = new Date().getTime()
    return (now - (this.startTime ?? now)) / 1000
  }
  start() {
    const p = childProcess.spawn('sh', ['-c', this.cmd])
    this.startTime = new Date().getTime()
    p?.stdout!.on('data', (data: string) => {
      // tslint:disable-next-line: no-parameter-reassignment
      data = `${data}`.trim()

      Log.debug(
        data
          .split('\n')
          .map((l) => `${this.name}:DATA-LINE:${l}`)
          .join('\n'),
      )
      if (this.outputProcessor) return this.outputProcessor(data, this)
      this.processOutput(data)
    })
    this.process = p
  }

  processOutput(data: string) {
    Log.warn('processLine not implemented on ', this.constructor.name)
  }

  stop() {
    if (this.process) {
      Log.debug(`${this.name} stop `)
      this.process.stdin?.end()
      this.process.kill()
    }
  }

  emitSample(sample: T) {
    this.samples.push(sample)
    this.currentValue = sample
  }

  toJson(): MetricData {
    return {
      name: this.name,
      metric: this.metric,
      samples: this.samples,
      dataSets: this.getDataSets() || [],
    }
  }

  report() {
    const dataSets = this.getDataSets()

    if (!dataSets) {
      return `${this.name}(${this.constructor.name}) no datasets to report`
    }

    return dataSets
      .map(
        (ds) => `
  __${ds.name}__
  ${chart(ds)}`,
      )
      .join('\n')
  }

  getDataSets(): Dataset[] | null {
    return null
  }
}

// tslint:disable-next-line: max-classes-per-file
export class ProcessMetricCollector extends MetricCollector<ProcStat> {
  initialValue() {
    return { cpu: 0, mem: 0, tick: 0 }
  }
  processOutput(output: string) {
    // todo: what when multiple processes match, do we sum? is it an error?
    assert(
      output.split('\n').length === 1,
      'multiple processes are not supported',
    )

    const { cpu, mem } = parseShellOutput(output, ['cpu', 'mem'])
    this.emitSample({
      cpu: parseFloat(cpu),
      mem: parseBytes(mem),
      tick: this.tick,
    })
  }

  getDataSets() {
    return [
      {
        name: 'CPU',
        data: this.samples.map((v) => ({ value: v.cpu, tick: v.tick })),
        dataType: DataType.value,
      },
      {
        name: 'MEMORY',
        data: this.samples.map((v) => ({ value: v.mem, tick: v.tick })),
        dataType: DataType.bytes,
      },
    ]
  }
}

// tslint:disable-next-line: max-classes-per-file
export class NetworkMetricCollector extends MetricCollector<NetStat> {
  initialValue() {
    return { rx: 0, tx: 0, tick: 0 }
  }
  processOutput(output: string) {
    const { rx, tx } = parseShellOutput(output, ['name', 'rx', 'tx'])
    this.emitSample({ rx: parseBytes(rx), tx: parseBytes(tx), tick: this.tick })
  }
  startNetOffset = { rx: 0, tx: 0 }

  emitSample(sample: NetStat) {
    // Net stats accumulate so we diff from previous value to get samples change
    if (this.samples.length === 0) {
      this.startNetOffset = sample
      super.emitSample(this.initialValue())
    } else {
      const s = {
        rx: sample.rx - this.startNetOffset.rx,
        tx: sample.tx - this.startNetOffset.tx,
        tick: this.tick,
      }
      const last = this.samples[this.samples.length - 1]
      if (s.rx < last.rx || s.tx < last.tx) {
        Log.warn(`%{this.name}: invalid sample (skipped)`, {
          sample,
          lastSample: last,
        })
        return
      }
      super.emitSample(s)
    }
  }

  getDataSets() {
    return [
      {
        name: 'DATA RECEIVED',
        data: this.samples.map((v) => ({ value: v.rx, tick: v.tick })),
        dataType: DataType.bytes,
      },
      {
        name: 'DATA SENT',
        data: this.samples.map((v) => ({ value: v.tx, tick: v.tick })),
        dataType: DataType.bytes,
      },
    ]
  }
}

// tslint:disable-next-line: max-classes-per-file
export class WebKitMetricCollector extends NetworkMetricCollector {
  /*
    Webkit has multiple processes so we need to sum the individual ones
     */
  processMap: { [pid: string]: NetStat } = {}

  processOutput(output: string) {
    output
      .split('\n')
      .map((line) => parseShellOutput(line, ['name', 'rx', 'tx']))
      .forEach(({ name, rx, tx }: { name: string; rx: string; tx: string }) => {
        this.processMap[name] = {
          rx: parseBytes(rx),
          tx: parseBytes(tx),
          tick: this.tick,
        }
      })
    const processTotals = Object.values(this.processMap)
    const s = {
      rx: sum(processTotals.map((p) => p.rx)),
      tx: sum(processTotals.map((p) => p.tx)),
      tick: this.tick,
    }

    this.emitSample(s)
  }
}
