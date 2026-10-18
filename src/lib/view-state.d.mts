export type ViewState={hasCamera?:boolean;grid?:string;mode:string;tab:string;facility:string|null;lon:number;lat:number;zoom:number;watershed:number;plants:boolean;centers:boolean;planned:boolean;fuels:string[]};
export function parseView(search:string):ViewState;
export function serializeView(view:ViewState):string;
