import { observable, computed, action } from 'mobx';
import { find } from 'lodash';

import AppStore from './AppStore';
import { SEND_STATE, MESSAGE_TYPE, TRANSACTION_SPEED } from '../../constants';
import { isValidAddress, isValidAmount, isValidGasLimit, isValidGasPrice } from '../../utils';
import QRCToken from '../../models/QRCToken';
import Config from '../../config';

const INIT_VALUES = {
  tokens: [],
  senderAddress: undefined,
  receiverAddress: '',
  token: undefined,
  amount: '',
  maxAmount: undefined,
  maxEurekaCoinSend: undefined,
  sendState: SEND_STATE.INITIAL,
  errorMessage: undefined,
  transactionSpeed: TRANSACTION_SPEED.NORMAL,
  transactionSpeeds: [TRANSACTION_SPEED.SLOW, TRANSACTION_SPEED.NORMAL, TRANSACTION_SPEED.FAST],
  gasLimit: Config.TRANSACTION.DEFAULT_GAS_LIMIT,
  gasPrice: Config.TRANSACTION.DEFAULT_GAS_PRICE * 1e8,
  gasLimitRecommendedAmount: Config.TRANSACTION.DEFAULT_GAS_LIMIT,
  gasPriceRecommendedAmount: Config.TRANSACTION.DEFAULT_GAS_PRICE * 1e8, // satoshi/gas
};

export default class SendStore {
  @observable public tokens: QRCToken[] = INIT_VALUES.tokens;
  @observable public senderAddress?: string = INIT_VALUES.senderAddress;
  @observable public receiverAddress?: string = INIT_VALUES.receiverAddress;
  @observable public token?: QRCToken = INIT_VALUES.token;
  @observable public amount: number | string = INIT_VALUES.amount;
  @observable public maxEurekaCoinSend?: number = INIT_VALUES.maxEurekaCoinSend;
  public transactionSpeeds: string[] = INIT_VALUES.transactionSpeeds;
  @observable public transactionSpeed?: string = INIT_VALUES.transactionSpeed;
  @observable public gasLimit: number = INIT_VALUES.gasLimitRecommendedAmount;
  @observable public gasPrice: number = INIT_VALUES.gasPriceRecommendedAmount;
  public gasLimitRecommendedAmount: number = INIT_VALUES.gasLimitRecommendedAmount;
  public gasPriceRecommendedAmount: number = INIT_VALUES.gasPriceRecommendedAmount;
  @observable public sendState: SEND_STATE = INIT_VALUES.sendState;
  @observable public errorMessage?: string = INIT_VALUES.errorMessage;
  @computed public get maxTxFee(): number | undefined {
    return this.gasPrice && this.gasLimit
      ? Number(this.gasLimit) * Number(this.gasPrice) * 1e-8 : undefined;
  }
  @computed public get receiverFieldError(): string | undefined {
    return isValidAddress(this.app.sessionStore.isMainNet, this.receiverAddress)
      ? undefined : 'Not a valid EurekaCoin address';
  }
  @computed public get amountFieldError(): string | undefined {
    return this.maxAmount && isValidAmount(Number(this.amount), this.maxAmount) ? undefined : 'Not a valid amount';
  }
  @computed public get gasLimitFieldError(): string | undefined {
    return isValidGasLimit(this.gasLimit) ? undefined : 'Not a valid gas limit';
  }
  @computed public get gasPriceFieldError(): string | undefined {
    return isValidGasPrice(this.gasPrice) ? undefined : 'Not a valid gas price';
  }
  @computed public get buttonDisabled(): boolean {
    return !this.senderAddress || !!this.receiverFieldError || !this.token || !!this.amountFieldError;
  }
  @computed public get maxAmount(): number | undefined {
    if (this.token) {
      if (this.token.symbol === 'EUREKACOIN') {
        return this.maxEurekaCoinSend;
      }
      return this.token!.balance;
    }
    return undefined;
  }

  private app: AppStore;

  constructor(app: AppStore) {
    this.app = app;
  }

  @action
  public init = () => {
    chrome.runtime.onMessage.addListener(this.handleMessage);
    chrome.runtime.sendMessage({ type: MESSAGE_TYPE.GET_QRC_TOKEN_LIST }, (response: any) => {
      this.tokens = response;
      this.tokens.unshift(new QRCToken('EurekaCoin Token', 'EUREKACOIN', 8, ''));
      this.tokens[0].balance = this.app.sessionStore.info ? this.app.sessionStore.info.balance : undefined;
      this.token = this.tokens[0];
    });
    this.senderAddress = this.app.sessionStore.info ? this.app.sessionStore.info.addrStr : undefined;
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.GET_MAX_EUREKACOIN_SEND,
    });
  }

  @action
  public changeToken = (tokenSymbol: string) => {
    const token = find(this.tokens, { symbol: tokenSymbol });
    if (token) {
      this.token = token;
    }
  }

  @action
  public routeToSendConfirm = () => {
    this.app.routerStore.push('/send-confirm');
  }

  @action
  public send = () => {
    if (!this.token) {
      return;
    }

    this.sendState = SEND_STATE.SENDING;
    if (this.token.symbol === 'EUREKACOIN') {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPE.SEND_TOKENS,
        receiverAddress: this.receiverAddress,
        amount: Number(this.amount),
        transactionSpeed: this.transactionSpeed,
      });
    } else {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPE.SEND_QRC_TOKENS,
        receiverAddress: this.receiverAddress,
        amount: Number(this.amount),
        token: this.token,
        gasLimit: Number(this.gasLimit),
        gasPrice: Number(this.gasPrice),
      });
    }
  }

  @action
  private handleMessage = (request: any) => {
    switch (request.type) {
      case MESSAGE_TYPE.SEND_TOKENS_SUCCESS:
        this.app.routerStore.push('/home'); // so pressing back won't go back to sendConfirm page
        this.app.routerStore.push('/account-detail');
        this.sendState = SEND_STATE.INITIAL;
        break;
      case MESSAGE_TYPE.SEND_TOKENS_FAILURE:
        this.sendState = SEND_STATE.INITIAL;
        this.errorMessage = request.error.message;
        break;
      case MESSAGE_TYPE.GET_MAX_EUREKACOIN_SEND_RETURN:
        const eurekacoinToken = this.tokens[0];
        this.maxEurekaCoinSend = request.maxEurekaCoinAmount / (10 ** eurekacoinToken.decimals);
        break;
      default:
        break;
    }
  }
}
