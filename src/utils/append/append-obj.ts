export const appendObjectsTransformer = <
  K1 extends string,
  O1,
  K2 extends string,
  O2
>(
  key1: K1,
  obj1: O1,
  key2: K2,
  obj2: O2
): { [P in K1 | K2]: P extends K1 ? O1 : O2 } => {
  return {
    [key1]: obj1,
    [key2]: obj2,
  } as { [P in K1 | K2]: P extends K1 ? O1 : O2 };
};

export const appendObjectsTransformerFactory = <
  K1 extends string,
  O1,
  K2 extends string,
  O2
>(
  key1: K1,
  obj1: O1,
  key2: K2
) => {
  return (obj2: O2) => appendObjectsTransformer(key1, obj1, key2, obj2);
};
