/**
 * ESLint rule: no-field-group-in-grid
 * Disallows `.field-group` inside grid contexts (classes including `__grid`).
 */

function extractClassNamesFromAttribute(attr) {
  if (!attr || attr.type !== 'JSXAttribute' || !attr.name || attr.name.name !== 'className') {
    return [];
  }

  const { value } = attr;
  if (!value) return [];

  if (value.type === 'Literal' || value.type === 'JSXText') {
    return ('' + value.value).split(/\s+/).filter(Boolean);
  }

  if (value.type === 'JSXExpressionContainer') {
    const expr = value.expression;
    if (!expr) return [];

    if (expr.type === 'Literal') {
      return ('' + expr.value).split(/\s+/).filter(Boolean);
    }

    if (expr.type === 'TemplateLiteral') {
      // Join quasis - ignore expressions inside templates for safety
      const raw = expr.quasis.map(q => q.value.cooked).join(' ');
      return raw.split(/\s+/).filter(Boolean);
    }

    if (expr.type === 'CallExpression') {
      const names = [];
      expr.arguments.forEach(arg => {
        if (!arg) return;
        if (arg.type === 'Literal') names.push(arg.value);
        if (arg.type === 'TemplateLiteral') names.push(arg.quasis.map(q => q.value.cooked).join(' '));
        if (arg.type === 'ObjectExpression') {
          arg.properties.forEach(prop => {
            if (prop.type === 'Property') {
              if (prop.key && prop.key.type === 'Identifier') names.push(prop.key.name);
              if (prop.key && prop.key.type === 'Literal') names.push(prop.key.value);
            }
          });
        }
      });
      return names.flat().filter(Boolean);
    }
  }
  return [];
}

function classListHasToken(list, tokenSubstr) {
  return list.some(cls => typeof cls === 'string' && cls.includes(tokenSubstr));
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow `.field-group` inside grid contexts (classes including `__grid`).',
      recommended: 'error',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXElement(node) {
        const attrs = node.openingElement.attributes || [];
        const nodeClassNames = extractClassNamesFromAttribute(attrs.find(a => a.type === 'JSXAttribute' && a.name && a.name.name === 'className'));
        if (!classListHasToken(nodeClassNames, 'field-group')) return;

        // Walk up the parent chain to find grid contexts.
        let anc = node.parent;
        while (anc) {
          if (anc.type === 'JSXElement') {
            const ancAttrs = anc.openingElement.attributes || [];
            const ancClassNames = extractClassNamesFromAttribute(ancAttrs.find(a => a.type === 'JSXAttribute' && a.name && a.name.name === 'className'));
            if (classListHasToken(ancClassNames, '__grid')) {
              context.report({
                node: node.openingElement,
                message: "Use 'field-group--inline--grid' (or 'field-group--inline--flow') instead of 'field-group' inside grid contexts.",
              });
              return;
            }
          }
          anc = anc.parent;
        }
      },
    };
  },
};