import axios from 'axios';

import EurekaLiteController from '.';
import IController from './iController';
import { MESSAGE_TYPE } from '../../constants';

const INIT_VALUES = {
  getPriceInterval: undefined,
  eurekacoinPriceUSD: 0,
};

export default class ExternalController extends IController {
  private static GET_PRICE_INTERVAL_MS: number = 60000;

  private getPriceInterval?: number = INIT_VALUES.getPriceInterval;
  private eurekacoinPriceUSD: number = INIT_VALUES.eurekacoinPriceUSD;

  constructor(main: EurekaLiteController) {
    super('external', main);
    this.initFinished();
  }

  public calculateEurekaCoinToUSD = (balance: number): number => {
    return this.eurekacoinPriceUSD ? Number((this.eurekacoinPriceUSD * balance).toFixed(2)) : 0;
  }

  /*
  * Starts polling for periodic info updates.
  */
  public startPolling = async () => {
    await this.getEurekaCoinPrice();
    if (!this.getPriceInterval) {
      this.getPriceInterval = window.setInterval(() => {
        this.getEurekaCoinPrice();
      }, ExternalController.GET_PRICE_INTERVAL_MS);
    }
  }

  /*
  * Stops polling for the periodic info updates.
  */
  public stopPolling = () => {
    if (this.getPriceInterval) {
      clearInterval(this.getPriceInterval);
      this.getPriceInterval = undefined;
    }
  }

  /*
  * Gets the current EurekaCoin market price.
  */
  private getEurekaCoinPrice = async () => {
    try {
      // const jsonObj = await axios.get('https://api.coinmarketcap.com/v2/ticker/1684/');
      // this.eurekacoinPriceUSD = jsonObj.data.data.quotes.USD.price;
      const jsonObj = await axios.get('https://api.coinpaprika.com/v1/ticker/erk-eureka-coin');
      this.eurekacoinPriceUSD = jsonObj.data.data.quotes.USD.price;

      if (this.main.account.loggedInAccount
        && this.main.account.loggedInAccount.wallet
        && this.main.account.loggedInAccount.wallet.info
      ) {
        const eurekacoinUSD = this.calculateEurekaCoinToUSD(this.main.account.loggedInAccount.wallet.info.balance);
        this.main.account.loggedInAccount.wallet.eurekacoinUSD = eurekacoinUSD;

        chrome.runtime.sendMessage({
          type: MESSAGE_TYPE.GET_EUREKACOIN_USD_RETURN,
          eurekacoinUSD,
        });
      }
    } catch (err) {
      console.log(err);
    }
  }
}
