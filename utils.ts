import { DataType, Dataset } from './metrics'
import shell from 'shelljs'

export const avg = (arr: any[]) => {
  return arr.length === 0 ? 0 : Math.round(sum(arr) / arr.length)
}
export const sum = (arr: any[]) =>
  arr.reduce((a, b) => a + (parseFloat(b) || 0), 0)

export const diff = (arr: any[]) => arr.slice(1).map((n, i) => n - arr[i])

export function time(duration: number) {
  const milliseconds = parseInt(`${(duration % 1000) / 100}`, 10)
  let seconds: any = Math.floor((duration / 1000) % 60),
    minutes: any = Math.max(0, Math.floor((duration / (1000 * 60)) % 60)),
    hours: any = Math.max(0, Math.floor((duration / (1000 * 60 * 60)) % 24))

  hours = hours < 10 ? `0${hours}` : hours
  minutes = minutes < 10 ? `0${minutes}` : minutes
  seconds = seconds < 10 ? `0${seconds}` : seconds

  return `${hours}:${minutes}:${seconds}.${milliseconds}`
}

export const parseBytes = (mem: string) => {
  if (typeof mem === 'number') return mem
  if (!mem) return 0
  const num = parseInt(mem.replace(/\D*/, ''), 10)
  const f = mem.replace(/\d*/, '').trim()[0]
  switch (f) {
    case 'M':
      return num * 1024 * 1024
    case 'G':
      return num * 1024 * 1024 * 1024
    case 'K':
      return num * 1024
    default:
      return num
  }
}

export function formatBytes(a: number, b: number = 1) {
  // tslint:disable-next-line: max-line-length
  // from: https://stackoverflow.com/questions/15900485/correct-way-to-convert-size-in-bytes-to-kb-mb-gb-in-javascript
  if (0 === a) return '0 Bytes'
  const c = 1024,
    d = b || 2,
    e = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'],
    f = Math.floor(Math.log(a) / Math.log(c))
  // tslint:disable-next-line: prefer-template
  return parseFloat((a / Math.pow(c, f)).toFixed(d)) + ' ' + e[f]
}

export const parseShellOutput = (shellOutput: string, cols: string[]) => {
  const output = `${shellOutput}`
    .trim()
    .replace(/ +/g, ' ')
    .split(' ')
    .reduce((a, v, i) => {
      if (cols[i]) a[cols[i]] = v
      return a
    }, {} as any)
  return output
}

export const androidPidForPackage = (pkg: string) => {
  return shell.exec(`adb shell pidof ${pkg} `, { silent: true }).stdout.trim()
}

export const androidUidForPackage = (pkg: string) => {
  const uid: string = shell
    .exec(`adb shell dumpsys package ${pkg} | grep userId=`, {
      silent: true,
    })
    .stdout.trim()
    .replace(/\s*userId=/, '')
  return uid
}

// see https://stackoverflow.com/questions/9574089/osx-bash-watch-command
export const watch = (cmd: string) => `while :; do  ${cmd}; sleep 2; done`

export enum LogLevel {
  Debug = 0,
  Verbose = 1,
  Info = 2,
  Warn = 3,
  Error = 4,
}
// tslint:disable-next-line: max-classes-per-file
export class Log {
  static level: LogLevel = LogLevel.Info
  static debug(...args: any[]) {
    if (Log.level > LogLevel.Debug) return
    console.log(...args)
  }
  static verbose(...args: any[]) {
    if (Log.level > LogLevel.Verbose) return
    console.log(...args)
  }
  static info(...args: any[]) {
    if (Log.level > LogLevel.Info) return
    console.log(...args)
  }
  static warn(...args: any[]) {
    if (Log.level > LogLevel.Warn) return
    console.log(...args)
  }
  static error(...args: any[]) {
    if (Log.level > LogLevel.Error) return
    console.log(...args)
  }
}

export const chart = (dataset: Dataset) => {
  let { data, name } = dataset

  if (dataset.dataType === DataType.bytes) {
    data = data.map(d => d / 1024 / 1024)
    name = `${name} (MB)`
  }

  return `
  \`\`\`chart
  ${JSON.stringify(
    {
      type: 'line',

      data: {
        labels: range(0, dataset.data.length),
        datasets: [
          {
            data,
            label: name,
            borderColor: 'blue',
            fill: false,
          },
        ],
      },
    },
    null,
    '    ',
  )}
  \`\`\`
  `
}

export function range(start: number, end: number) {
  const a = []
  for (let i = start; i <= end; i++) {
    a.push(i)
  }
  return a
}

/*
 * ////////////////
 * Polyfills
 * /////////////////
 */

try {
  ;[].flatMap(i => i)
} catch (e) {
  ;((Array.prototype as unknown) as any).flatMap = function(cb: () => any) {
    return [].concat(...this.map(cb))
  }
}
