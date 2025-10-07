// Shim to allow Parcel to resolve vscode module
// The actual vscode module is provided by VS Code at runtime
// Use eval to prevent Parcel from resolving it at build time
module.exports = eval('require')('vscode');

