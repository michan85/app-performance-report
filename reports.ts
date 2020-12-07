import shell from 'shelljs'
import fs from 'fs'
import { RunData, Metrics } from './recorder'
import { Dataset } from './metrics'
import { chart, avg, diff, formatBytes, time } from './utils'
import * as math from 'mathjs'

class Report {
  folder: string
  constructor(args: { folder: string } & any) {
    this.folder = args.folder
    Object.assign(this, args)
  }

  // tslint:disable-next-line: no-empty
  generate() {}

  writeFile(fileName: string, content: string) {
    if (this.folder) {
      shell.exec(`mkdir -p ${this.folder}`)
    }
    fs.writeFileSync(fileName, content, {
      encoding: 'utf8',
    })
    return fileName
  }
}
// tslint:disable-next-line: max-classes-per-file
export class RunReport extends Report {
  data: RunData

  constructor(data: RunData, folder: string = '') {
    super({ folder })
    this.data = data
  }

  fileName(type: string, ext = 'json') {
    const data = this.data
    let fileName = `${data.name}_${data.runId}_${type}.${ext}`
    if (this.folder) {
      fileName = `${this.folder}/${fileName}`
    }
    return fileName
  }
}

export const DataSetChart = (ds: Dataset) => {
  return `
__${ds.name}__
${chart(ds)}`
}

// tslint:disable-next-line: max-classes-per-file
export class RawDataExport extends RunReport {
  generate() {
    return this.writeFile(
      this.fileName('data'),
      JSON.stringify(this.data, null, '  '),
    )
  }
}

// tslint:disable-next-line: max-classes-per-file
export class MarkdownRunReport extends RunReport {
  generate() {
    const name = this.data.reportName ?? this.data.name
    const data = this.data

    const metricCollectors = this.data.metrics
      .map(
        (mc) => `
## ${mc.name}

${mc.dataSets.map(DataSetChart).join('\n')}`,
      )
      .join('\n')

    const tpl = `
# ${name} Profile Report
for ${this.data.name}

${data.summary}

# Metrics Collectors

${metricCollectors}
`
    return this.writeFile(this.fileName('report', 'md'), tpl)
  }
}

export const runSummary = (data: RunData) => {
  const tot = computeTotals(data)
  return `Profile Complete: ${time(data.duration)}

  - CPU: ${tot.cpuAvg}% AVG (${tot.cpuMax}% MAX )
  - MEM: ${formatBytes(tot.memAvg)} AVG (${formatBytes(tot.memMax)} MAX)
  - RX:  ${formatBytes(tot.rxTot)}
  - TX:  ${formatBytes(tot.txTot)}
  `
}

const processMetrics = (data: RunData) => {
  return data.metrics.filter((m) => m.metric === Metrics.Process)
}
const netMetrics = (data: RunData) => {
  return data.metrics.filter((m) => m.metric === Metrics.Network)
}

export const computeTotals = (data: RunData) => {
  const proc = processMetrics(data).flatMap((m) => m.samples),
    net = netMetrics(data).flatMap((m) => m.samples),
    cpu = proc.map((s) => s.cpu),
    mem = proc.map((p) => p.mem),
    rx = net.map((p) => p.rx),
    tx = net.map((p) => p.tx)

  return {
    cpuAvg: avg(cpu),
    cpuMax: Math.max(...cpu),
    memAvg: avg(mem),
    memMax: Math.max(...mem),
    rxTot: Math.max(...rx),
    rxAvg: avg(diff(rx)),
    txTot: Math.max(...tx),
    txAvg: avg(diff(tx)),
  }
}
const fmt = (n: number) => parseFloat(n.toFixed(2))
const loadSession = (folder: string) => {
  const runs = shell
    .ls(`${folder}/*data.json`)
    .map((d) => JSON.parse(fs.readFileSync(d).toString())) as RunData[]

  const totals = runs.map(computeTotals)

  const dsAvg = (data: number[]) => ({
    avg: fmt(avg(data)),
    stdDev: fmt(math.std(data)),
    stdDevP: fmt((math.std(data) / avg(data)) * 100),
  })
  return {
    cpu: dsAvg(totals.map((t) => t.cpuAvg)),
    mem: dsAvg(totals.map((t) => t.memAvg)),
    rxTot: dsAvg(totals.map((t) => t.rxTot)),
    txTot: dsAvg(totals.map((t) => t.txTot)),
    duration: dsAvg(runs.map((r) => r.duration)),
    runs: totals.length,
  }
}

// tslint:disable-next-line: max-classes-per-file
export class SessionReport extends Report {
  generate() {
    console.log(loadSession(this.folder))
  }
}

const sessionCompare = (a: string, b: string, bName: string = b) => {
  const sessionA = loadSession(a),
    sessionB = loadSession(b)

  const desc = (
    va: number,
    vb: number,
    before: string,
    middle: string,
    after: string,
    formatter: (v: number) => string,
  ) => {
    const d = (1 - va / vb) * 100
    const descLine = `${before}${fmt(Math.abs(d))}% ${
      d > 0 ? 'more' : 'less'
    } ${middle} (${formatter(va)} vs ${formatter(vb)}) ${after}`.trim()

    return {
      baseLine: va,
      variation: vb,
      desc: descLine,
      pctChange: d,
    }
  }

  const data = {
    cpu: desc(
      sessionA.cpu.avg,
      sessionB.cpu.avg,
      `uses `,
      'CPU',
      '',
      (v) => `${v}%`,
    ),
    mem: desc(
      sessionA.mem.avg,
      sessionB.mem.avg,
      `uses `,
      'Memory',
      '',
      formatBytes,
    ),
    rx: desc(
      sessionA.rxTot.avg,
      sessionB.rxTot.avg,
      `received `,
      'Data',
      '',
      formatBytes,
    ),
    tx: desc(
      sessionA.txTot.avg,
      sessionB.txTot.avg,
      `sent `,
      'Data',
      '',
      formatBytes,
    ),
    data: desc(
      sessionA.txTot.avg + sessionA.rxTot.avg,
      sessionB.txTot.avg + sessionA.rxTot.avg,
      `uses `,
      'Data',
      '',
      formatBytes,
    ),
  }
  return { data, baseLine: a, variation: b }
}
// tslint:disable-next-line: max-classes-per-file
export class SessionCompareReport extends Report {
  baseLine!: string
  variations!: string[]
  constructor({
    baseLine,
    variations,
  }: {
    baseLine: string
    variations: string[]
  }) {
    super({ baseLine, variations })
  }

  generate() {
    const data = this.variations.map((v) => sessionCompare(this.baseLine, v))

    const tpl = data
      .map(
        (compare) => `
## ${compare.variation}

${Object.values(compare.data)
  .map((m) => (Math.abs(m.pctChange) > 10 ? `__${m.desc}__` : m.desc))
  .map((m) => `- ${m}`)
  .join('\n')}`,
      )
      .join('\n')

    console.log(tpl)
  }
}
