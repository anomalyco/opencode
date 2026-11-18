// @ts-nocheck

import fs from "fs";
import ts from "typescript";
import prettier from "prettier";

const config = process.argv[2];
const pkg = process.argv[3];
const version = process.argv[4];

const code = fs.readFileSync(config);

const sourceFile = ts.createSourceFile(
  "temp.ts",
  code.toString(),
  ts.ScriptTarget.Latest,
  true,
);

// Find the default export declaration
const exportAssignment = sourceFile.statements.find((statement) =>
  ts.isExportAssignment(statement),
);

// Find the "$config" call expression
const configCallExpression = exportAssignment.expression;

// Find the "app" function declaration inside the "$config" call
const appFunctionDeclaration =
  configCallExpression.arguments[0].properties.find(
    (property) => property.name.getText() === "app",
  );

const returnStatement = appFunctionDeclaration.body?.statements.find(
  (statement) =>
    ts.isReturnStatement(statement) &&
    ts.isObjectLiteralExpression(statement.expression),
);

// Find the "providers" property inside the "app" function
let providersProperty = returnStatement.expression?.properties.find(
  (property) =>
    ts.isPropertyAssignment(property) &&
    property.name.getText() === "providers",
);

if (!providersProperty) {
  providersProperty = ts.factory.createPropertyAssignment(
    "providers",
    ts.factory.createObjectLiteralExpression([]),
  );
  returnStatement.expression.properties.push(providersProperty);
}

if (
  providersProperty.initializer.properties.find(
    (property) => property.name.getText().replaceAll('"', "") === pkg,
  )
) {
  process.exit(0);
}
// Create a new property node for "foo: {}"
const newProperty = ts.factory.createPropertyAssignment(
  ts.factory.createStringLiteral(pkg),
  ts.factory.createStringLiteral(version),
);

providersProperty.initializer.properties.push(newProperty);

const printer = ts.createPrinter();
const modifiedCode = printer.printNode(
  ts.EmitHint.Unspecified,
  sourceFile,
  sourceFile,
);

const formattedCode = await prettier.format(modifiedCode, {
  parser: "typescript",
});
fs.writeFileSync(config, formattedCode);
