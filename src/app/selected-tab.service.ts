import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { MechanismService } from './services/mechanism.service';
import { ActiveObjService } from 'src/app/services/active-obj.service';

export enum TabID {
  SYNTHESIZE, // kept for compatibility but no longer used as a separate tab
  EDIT,
  ANALYZE
}

@Injectable({
  providedIn: 'root'
})
export class SelectedTabService {

  private _tabNum: BehaviorSubject<TabID>;
  private _tabVisible: BehaviorSubject<boolean>;

  constructor(
    private mechanism: MechanismService,
    private activeObjService: ActiveObjService
  ) {
    this._tabNum = new BehaviorSubject<TabID>(TabID.EDIT);
    this._tabVisible = new BehaviorSubject<boolean>(true);
  }

  public setTab(tabID: TabID) {
    // SYNTHESIZE is now merged into EDIT
    if (tabID === TabID.SYNTHESIZE) tabID = TabID.EDIT;

    let previousTab = this.getCurrentTab();
    let isDifferentTab = previousTab !== tabID;

    this._tabNum.next(tabID);
    this._tabVisible.next(true);

    if (isDifferentTab) this.onNewTab(previousTab);
  }

  public showTab() {
    this._tabVisible.next(true);
  }

  public hideTab() {
    this._tabVisible.next(false);
  }

  public getCurrentTab() {
    return this._tabNum.getValue();
  }

  public isTabVisible() {
    return this._tabVisible.getValue();
  }

  private onNewTab(previousTab: TabID) {
    if (previousTab !== this.getCurrentTab()) {
      this.mechanism.save();
    }
  }
}
