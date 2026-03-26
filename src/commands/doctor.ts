import { Doctor } from '../util/doctor.js'

export class DoctorCommand {
  async run(outputJson: boolean = false): Promise<void> {
    const doctor = new Doctor()
    const results = await doctor.runAll()

    if (outputJson) {
      console.log(JSON.stringify(results, null, 2))
      process.exit(doctor.hasFailed() ? 1 : 0)
      return
    }

    doctor.printResults()
    process.exit(doctor.hasFailed() ? 1 : 0)
  }
}
