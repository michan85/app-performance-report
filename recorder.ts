import {
  MetricCollector,
  ProcStat,
  NetStat,
  ProcessMetricCollector,
  NetworkMetricCollector,
  WebKitMetricCollector,
  MetricData,
  Sample,
} from './metrics'
import {
  sum,
  avg,
  Log,
  formatBytes,
  diff,
  androidUidForPackage,
  parseShellOutput,
  time,
  watch,
} from './utils'
import { strict as assert } from 'assert'
import shell from 'shelljs'
import readline from 'readline'
import fs from 'fs'
import { MarkdownRunReport, RawDataExport, runSummary } from './reports'

export interface PerformanceRecorderArgs {
  name: string
  interactive?: boolean
  folder?: string
  runReport: boolean
  export: boolean
  reportName?: string
}

export interface RunData<T = any> {
  runId: string
  summary: string
  name: string
  reportName: string
  duration: number
  metrics: Array<MetricData<T>>
}

export enum Metrics {
  Process = 'proc',
  Network = 'net',
}

// tslint:disable-next-line: max-classes-per-file
export class PerformanceRecorder<T extends Sample = any> {
  timer: any
  interactive = false
  folder?: string
  startTime?: Date
  name: string
  reportName?: string
  duration = -1
  runReport = true
  export = true

  constructor(o: PerformanceRecorderArgs) {
    this.name = o.name
    Object.assign(this, o)
    this.createMetrics()
  }

  createMetrics() {
    assert(
      false,
      `createMetrics must be overridden by ${this.constructor.name}`,
    )
  }

  metrics = [] as Array<MetricCollector<T>>

  start() {
    this.startTime = new Date()
    if (this.interactive) {
      this.timer = setInterval(this.updateStats, 1000)
    }
    this.metrics.map((m) => m.start())
  }

  statsUpdate = 0
  loader = '|/-\\'
  updateStats = () => {
    this.statsUpdate++

    readline.clearLine(process.stdout, 0)
    readline.cursorTo(process.stdout, 0)
    const proc = (this.metrics.filter(
      (m) => m.metric === Metrics.Process,
    ) as unknown) as Array<MetricCollector<ProcStat>>
    const net = (this.metrics.filter(
      (m) => m.metric === Metrics.Network,
    ) as unknown) as Array<MetricCollector<NetStat>>
    const indicator = this.loader[this.statsUpdate % this.loader.length],
      cpu = sum(proc.map((m) => m.currentValue.cpu)),
      mem = sum(proc.map((m) => m.currentValue.mem)),
      rx = sum(net.map((m) => m.currentValue.rx)),
      tx = sum(net.map((m) => m.currentValue.tx)),
      avgCpu = avg(proc.flatMap((m) => m.samples.map((s) => s.cpu))),
      avgMem = avg(proc.flatMap((m) => m.samples.map((s) => s.mem)))

    const vars = [cpu, mem, rx, tx, avgCpu, avgMem]
    if (vars.some(Number.isNaN) || vars.some((v) => v < 0)) {
      Log.warn('Invalid Values probably a bug...', {
        cpu,
        mem,
        rx,
        tx,
        avgCpu,
        avgMem,
      })
    }
    const duration = new Date().getTime() - this.startTime!.getTime()
    process.stdout.write(
      `${indicator} cpu:${cpu}%(${avgCpu}) mem:${formatBytes(
        mem,
      )}(${formatBytes(avgMem)}) tx:${formatBytes(tx)} rx:${formatBytes(
        rx,
      )}  ${time(duration)}`,
    )
    Log.verbose(
      ...this.metrics.map(
        (s) => `\n${s.metric} ${s.name}: ${JSON.stringify(s.currentValue)}`,
      ),
    )
  }

  stop() {
    this.metrics.forEach((m) => m.stop())
    this.duration = new Date().getTime() - this.startTime!.getTime()
    if (this.timer) {
      clearInterval(this.timer)
    }

    if (this.interactive) {
      Log.info(`\n\n${runSummary(this.serialize())}\n\n`)
    }

    if (this.runReport) {
      this.report()
    }
    if (this.export) {
      this.save()
    }
  }

  get runId() {
    return this.startTime?.toISOString().slice(0, 19)
  }

  fileName(type: string, ext = 'json') {
    let fileName = `${this.name}_${this.runId}_${type}.${ext}`
    if (this.folder) {
      shell.exec(`mkdir -p ${this.folder}`)
      fileName = `${this.folder}/${fileName}`
    }
    return fileName
  }

  serialize(): RunData {
    const data = {
      runId: this.runId || '',
      summary: '',
      name: this.name,
      reportName: this.reportName ?? this.name,
      duration: this.duration,
      metrics: this.metrics.map((m) => m.toJson()),
    }
    data.summary = runSummary(data)
    return data
  }
  save() {
    const fileName = new RawDataExport(this.serialize(), this.folder).generate()

    if (this.interactive) {
      Log.info(`raw data saved to: ${fileName}`)
    }
  }

  report() {
    const fileName = new MarkdownRunReport(
      this.serialize(),
      this.folder,
    ).generate()

    if (this.interactive) {
      Log.info(`report saved to: ${fileName}`)
    }
  }

  doctor() {
    Log.warn('not implemented for this platform')
  }
}

// tslint:disable-next-line: max-classes-per-file
export class AndroidRecorder extends PerformanceRecorder {
  static RX_FIELD = 5
  static TX_FIELD = 7
  rxField = AndroidRecorder.RX_FIELD
  txField = AndroidRecorder.TX_FIELD

  createMetrics() {
    this.metrics.push(
      new ProcessMetricCollector({
        metric: Metrics.Process,
        cmd: `adb shell top -o %CPU,RES,CMDLINE  -s 1 -n 10000 | grep --line-buffered ${this.name}`,
      }),
    )

    const uid = androidUidForPackage(this.name)

    this.metrics.push(
      new NetworkMetricCollector({
        metric: Metrics.Network,
        cmd: watch(`adb shell cat /proc/net/xt_qtaguid/stats | grep ${uid}`),
        outputProcessor: (
          output: string,
          metricCollector: MetricCollector<NetStat>,
        ) => {
          const header = Array(Math.max(this.rxField, this.txField))
          header[this.rxField] = 'rx'
          header[this.txField] = 'tx'
          const entries = output
            .split('\n')
            .filter((l) => l)
            .map((line) => {
              const { rx, tx } = parseShellOutput(line, header)
              return { rx: parseFloat(rx), tx: parseFloat(tx) }
            })

          metricCollector.emitSample({
            rx: sum(entries.map((e) => e.rx)),
            tx: sum(entries.map((e) => e.tx)),
            tick: metricCollector.tick,
          })
        },
      }),
    )
  }

  doctor() {
    Log.info('checking for devices')
    const devices = shell
      .exec('adb devices', { silent: true })
      .stdout.trim()
      .split('\n')
      .slice(1)
    assert(devices.length !== 0, 'No devices connected')
    assert(devices.length === 1, 'Only one device can be connected')
    assert(!devices[0].includes('offline'), 'Device is offline')
    Log.info('SUCCESS')

    Log.info('checking adb commands')

    const netHeader = shell
      .exec('adb shell  cat /proc/net/xt_qtaguid/stats | head -n 1 ', {
        silent: true,
      })
      .stdout.trim()
      .split(' ')
      .map((s) => s.trim())

    try {
      assert(
        netHeader[this.rxField] === 'rx_bytes',
        `invalid rxField (${
          this.rxField
        }) , its should be set to ${netHeader.indexOf('rx_bytes')}`,
      )
      assert(
        netHeader[this.txField] === 'tx_bytes',
        `invalid txField (${
          this.txField
        }) , its should be set to ${netHeader.indexOf('tx_bytes')}`,
      )
    } catch (e) {
      Log.info('Available Net Header Fields: ', netHeader)
      throw e
    }
    Log.info('SUCCESS')
  }
}

// tslint:disable-next-line: max-classes-per-file
export class IOSRecorder extends PerformanceRecorder {
  createMetrics() {
    this.metrics.push(
      new ProcessMetricCollector({
        metric: Metrics.Process,
        cmd: `top -stats cpu,mem,command -c n | grep --line-buffered ${this.name}`,
      }),
    )

    this.metrics.push(
      new NetworkMetricCollector({
        name: 'App Collector',
        metric: Metrics.Network,
        cmd: `nettop -l 0 -x -J bytes_in,bytes_out | grep --line-buffered ${this.name}`,
      }),
    )
    this.metrics.push(
      new WebKitMetricCollector({
        metric: Metrics.Network,
        name: 'WebKit Collector',
        cmd: `nettop -l 0 -x -J bytes_in,bytes_out | grep --line-buffered com.apple.Web`,
      }),
    )
  }
}
