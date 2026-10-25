export enum InfoLvl {
  Fatal   = "FAT",
  Error   = "ERR",
  Warning = "WRN",
  Info    = "INF",
  Debug   = "DBG",
  Trace   = "TRA",
}

class Logger {
  public log(infoLvl: InfoLvl, message: string, data?: object): void {
    const timestamp = new Date().toISOString();
    console.log(JSON.stringify({
      info_lvl: infoLvl,
      timestamp: timestamp,
      message: message,
      ...data,
    }));
  }
}

export const logger = new Logger();
