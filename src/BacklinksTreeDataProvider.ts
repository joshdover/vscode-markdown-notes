import * as vscode from 'vscode';
import * as path from 'path';
import { NoteParser } from './NoteParser';
import { RefType } from './Ref';

type FileWithLocations = {
  file: string;
  locations: vscode.Location[];
};
export class BacklinksTreeDataProvider implements vscode.TreeDataProvider<BacklinkItem> {
  constructor(private workspaceRoot: string | null) {}
  _onDidChangeTreeData: vscode.EventEmitter<BacklinkItem> = new vscode.EventEmitter<BacklinkItem>();
  onDidChangeTreeData: vscode.Event<BacklinkItem> = this._onDidChangeTreeData.event;
  reload(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: BacklinkItem): vscode.TreeItem {
    return element;
  }

  // Take a flat list of locations, such as:
  // - file1.md, l1
  // - file2.md, l2
  // - file1.md, l3
  // And return as list of files with location lists:
  // - file1.md
  //   - l1
  //   - l3
  // - file2.md
  //   - l2
  // NB: does work well with relativePaths mode, assumes uniqueFilenames
  static locationListToTree(locations: vscode.Location[]): FileWithLocations[] {
    let m: Record<string, FileWithLocations> = {};
    locations.map((l) => {
      let f = path.basename(l.uri.fsPath);
      if (!m[f]) {
        let fwl: FileWithLocations = {
          file: f,
          locations: [],
        };
        m[f] = fwl;
      }
      m[f].locations.push(l);
    });
    let arr = Object.values(m);
    // sort the files by name:
    let asc = (a: string | number, b: string | number) => {
      if (a < b) {
        return -1;
      }
      if (a > b) {
        return 1;
      }
      return 0;
    };
    arr.sort((a, b) => asc(a.file, b.file));
    // sort the locations in each file by start position:
    return arr.map((fwl) => {
      fwl.locations.sort((locA, locB) => {
        let a = locA.range.start;
        let b = locB.range.start;
        if (a.line < b.line) {
          return -1;
        }
        if (a.line > b.line) {
          return 1;
        }
        // same line, compare chars
        if (a.character < b.character) {
          return -1;
        }
        if (a.character > b.character) {
          return 1;
        }
        return 0;
      });
      return fwl;
    });
  }

  getChildren(element?: BacklinkItem): Thenable<BacklinkItem[]> {
    let f = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!f) {
      // no activeTextEditor, so there can be no refs
      return Promise.resolve([]);
    }
    if (!this.workspaceRoot) {
      vscode.window.showInformationMessage('No refs in empty workspace');
      return Promise.resolve([]);
    }
    let activeFilename = path.basename(f);

    // TOP LEVEL:
    // Parse the workspace into list of FilesWithLocations
    // Return 1 collapsible element per file
    if (!element) {
      return Promise.all([
        NoteParser.searchBacklinksFor(activeFilename, RefType.WikiLink),
        NoteParser.searchBacklinksFor(activeFilename, RefType.Hyperlink),
      ]).then((arr) => {
        let locations: vscode.Location[] = arr[0].concat(arr[1]);
        let filesWithLocations = BacklinksTreeDataProvider.locationListToTree(locations);
        return filesWithLocations.map((fwl) => BacklinkItem.fromFileWithLocations(fwl));
      });
      // Given the collapsible elements,
      // return the children, 1 for each location within the file
    } else if (element && element.locations) {
      return Promise.all(
        element.locations.map((l) => BacklinkItem.fromLocation(l, element.filename))
      );
    } else {
      return Promise.resolve([]);
    }
  }
}

class BacklinkItem extends vscode.TreeItem {
  public readonly command?: vscode.Command;
  public readonly tooltip: string;
  public readonly description: string;
  public readonly iconPath?: vscode.ThemeIcon;

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly locations?: vscode.Location[],
    private readonly location?: vscode.Location,
    public readonly filename?: string,
    fileContents?: string
  ) {
    super(label, collapsibleState);
    this.filename = filename || '';
    if (this.location) {
      this.command = {
        command: 'vscode.open',
        arguments: [
          this.location.uri,
          {
            preview: true,
            selection: this.location.range,
          },
        ],
        title: 'Open File',
      };

      let lines = (fileContents || '').toString().split(/\r?\n/);
      let line = lines[this.location?.range.start.line];
      // Look back 12 chars before the start of the reference.
      // There is almost certainly a more elegant way to do this.
      let s = this.location?.range.start.character - 12;
      if (s < 20) {
        s = 0;
      }
      this.description = line.substr(s);
    } else if (this.locations) {
      let r = this.locations?.length == 1 ? 'Reference' : 'References';
      this.description = `${this.locations?.length} ${r}`;
    } else {
      this.description = '';
    }

    let lineText = this.location ? `line ${this.location?.range.start.line}` : undefined;
    this.tooltip =  [this.filename, lineText, this.description].filter(Boolean).join(': ');
    let r = this.locations?.length == 1 ? 'Reference' : 'References';
    this.iconPath = `${this.locations?.length} ${r}`;
  }

  // return the 1 collapsible Item for each file
  // store the locations within that file to the .locations attribute
  static fromFileWithLocations(fwl: FileWithLocations): BacklinkItem {
    let label = fwl.file;
    let cs = vscode.TreeItemCollapsibleState.Expanded;
    return new BacklinkItem(label, cs, fwl.locations, undefined, fwl.file);
  }

  // items for the locations within files
  static async fromLocation(location: vscode.Location, filename?: string): Promise<BacklinkItem> {
    // location / range is 0-indexed, but editor lines are 1-indexed
    let lineNum = location.range.start.line + 1;
    let label = `${lineNum}:`; // path.basename(location.uri.fsPath);
    let cs = vscode.TreeItemCollapsibleState.None;
    const file = await vscode.workspace.openTextDocument(location.uri);
    return new BacklinkItem(label, cs, undefined, location, filename, file.getText());
  }
}
