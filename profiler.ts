import program, { Command } from 'commander'
import readline from 'readline'
import { strict as assert } from 'assert'
import { Log, LogLevel } from './utils'

import {
  IOSRecorder,
  AndroidRecorder,
  PerformanceRecorder,
  RunData,
} from './recorder'
import { SessionReport, SessionCompareReport } from './reports'

/*
 * ////////////////
 * CLI
 * /////////////////
 */

const Platforms = {
  ios: IOSRecorder,
  android: AndroidRecorder,
}

const cliRecord = (
  platform: 'ios' | 'android',
  name: string,
  {
    folder,
    interactive,
    doctor,
    logLevel,
    report,
    save,
    reportName,
  }: {
    folder: string
    interactive: boolean
    doctor: boolean
    logLevel: string
    report: boolean
    save: boolean
    reportName: string
  },
) => {
  Log.level = (LogLevel as any)[
    Object.keys(LogLevel).find(
      (l) => l.toLowerCase() === logLevel.toLowerCase(),
    ) || 'Info'
  ]

  assert(typeof Log.level === 'number', `invalid logLevel: ${logLevel} `)

  readline.emitKeypressEvents(process.stdin)
  assert(platform in Platforms, `invalid platform ${platform}`)
  const RecorderClazz: typeof PerformanceRecorder = Platforms[platform]
  const profiler = new RecorderClazz({
    name,
    reportName,
    interactive,
    folder,
    runReport: report,
    export: save,
  })
  if (doctor) {
    try {
      profiler.doctor()
    } catch (e) {
      Log.warn('FAIL:', e.message)
    }
    return
  }
  profiler.start()
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.on('keypress', (key: string) => {
    // ctrl-c ( end of text )
    if (key === '\u0003') {
      profiler.stop()
      process.kill(-process.pid)
      process.exit()
    }
  })
}

program.description('android app performance stats via adb')

program
  .command('record-ios <appName> ')
  .description(
    'record stats for an ios app given its name, eg record-ios News24',
  )
  .option('--no-interactive', ` disables interactive mode, only print totals`)
  .option('--no-report', `dont generate run report`)
  .option('--no-save', `dont save data`)
  .option('-n, --reportName <name>', `the name of the profile`, '')
  .option('-f, --folder <folder>', `the folder to save the data to`, false)
  .option('-d, --doctor', `checks your setup`, false)
  .option(
    '-l, --log-level <logLevel>',
    `the log level, on of ${Object.keys(LogLevel).join(',')}`,
    'Info',
  )
  .action((appName, cmd) => cliRecord('ios', appName, cmd))

program
  .command('record-android <pkg>')
  .description(
    'record stats for an ios app given its package, eg record-android com.news24.ui.coe',
  )
  .option('--no-interactive', ` disables interactive mode, only print totals`)
  .option('--no-report', `dont generate run report`)
  .option('--no-save', `dont save data`)
  .option('-n, --reportName <name>', `the name of the profile`, '')
  .option('-f, --folder <folder>', `the folder to save the data to`, false)
  .option('-d, --doctor', `checks your setup`, false)
  .option(
    '-l, --log-level <logLevel>',
    `the log level, on of ${Object.keys(LogLevel).join(',')}`,
    'Info',
  )
  .action((pkg, cmd) => cliRecord('android', pkg, cmd))

program
  .command('session-report <folder>')
  .description(`compare runs in a folder`)
  .action((folder, cmd) => {
    new SessionReport({ folder }).generate()
  })

program
  .command(
    'session-compare <baseLine-path> <variation-path> [moreVariationPaths...]',
  )
  .description(`compare sessions`)
  .action((baseLine, variation, otherVariations, cmd) => {
    new SessionCompareReport({
      baseLine,
      variations: [variation, ...otherVariations],
    }).generate()
  })

program
  .on('command:*', (command: any) => {
    console.log(`\n\nInvalid Command: ${command}\n\n`)

    program.outputHelp()
    process.exitCode = 1
  })
  .parse(process.argv)
