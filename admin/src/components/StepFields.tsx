import {
  Box,
  Field,
  MultiSelect,
  MultiSelectOption,
  NumberInput,
  SingleSelect,
  SingleSelectOption,
  Switch,
  TextInput,
  Typography,
} from "@strapi/design-system";

import type { StepField } from "../../../shared/flow";
import type { ContentTypeInfo } from "../api/client";

/**
 * Render one declared input.
 *
 * The whole point of the field descriptors is that nothing here is typed free-hand where a
 * choice exists: a content-type is picked from what is installed, a field from that
 * content-type's own attributes, a schedule from named presets. Only genuinely open values —
 * a URL, a message, a nested condition group — stay text.
 */
const StepFields = ({
  fields,
  values,
  contentTypes,
  /** Content-type the sibling `uid` input selected, used to offer that type's field names. */
  scopeUid,
  onChange,
}: {
  fields: StepField[];
  values: Record<string, unknown>;
  contentTypes: ContentTypeInfo[];
  scopeUid?: string;
  onChange: (name: string, value: unknown) => void;
}) => {
  const monospace = {
    width: "100%",
    padding: 10,
    borderRadius: 4,
    border: "1px solid var(--neutral200, #dcdce4)",
    background: "var(--neutral0, #ffffff)",
    color: "var(--neutral800, #32324d)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    lineHeight: 1.5,
    resize: "vertical" as const,
  };

  return (
    <>
      {fields.map((field) => {
        const value = values[field.name];
        const key = `${field.name}`;

        const wrap = (children: React.ReactNode) => (
          <Box key={key} paddingTop={3}>
            <Field.Root name={key} hint={field.hint} required={field.required}>
              <Field.Label>{field.label}</Field.Label>
              {children}
              <Field.Hint />
            </Field.Root>
          </Box>
        );

        switch (field.type) {
          case "boolean":
            return wrap(
              <Switch
                checked={Boolean(value)}
                onCheckedChange={(next: boolean) => onChange(field.name, next)}
              />
            );

          case "number":
            return wrap(
              <NumberInput
                name={key}
                value={typeof value === "number" ? value : (field.default as number | undefined)}
                onValueChange={(next?: number) => onChange(field.name, next)}
              />
            );

          case "select":
            return wrap(
              <SingleSelect
                value={value === undefined ? "" : String(value)}
                placeholder={field.placeholder ?? "Pick one"}
                onChange={(next: string | number) => onChange(field.name, String(next))}
              >
                {(field.options ?? []).map((option) => (
                  <SingleSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            );

          case "content-type": {
            // `contentTypes` on a trigger is a list; `uid` on a step is a single value.
            const multiple = field.name === "contentTypes";
            const selected = Array.isArray(value) ? (value as string[]) : [];

            return wrap(
              multiple ? (
                <MultiSelect
                  value={selected}
                  placeholder="Every content-type"
                  onChange={(next: string[]) => onChange(field.name, next)}
                  withTags
                >
                  {contentTypes.map((type) => (
                    <MultiSelectOption key={type.uid} value={type.uid}>
                      {type.displayName}
                    </MultiSelectOption>
                  ))}
                </MultiSelect>
              ) : (
                <SingleSelect
                  value={typeof value === "string" ? value : ""}
                  placeholder="The triggering entry"
                  onChange={(next: string | number) => onChange(field.name, String(next))}
                >
                  {contentTypes.map((type) => (
                    <SingleSelectOption key={type.uid} value={type.uid}>
                      {type.displayName}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              )
            );
          }

          case "field": {
            const available =
              contentTypes.find((type) => type.uid === scopeUid)?.fields ?? [];

            // Without a chosen content-type there is no field list to offer, so this falls
            // back to text rather than presenting an empty dropdown.
            return wrap(
              available.length > 0 ? (
                <SingleSelect
                  value={typeof value === "string" ? value : ""}
                  placeholder={field.placeholder ?? "Pick a field"}
                  onChange={(next: string | number) => onChange(field.name, String(next))}
                >
                  {available.map((name) => (
                    <SingleSelectOption key={name} value={name}>
                      {name}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              ) : (
                <TextInput
                  name={key}
                  value={typeof value === "string" ? value : ""}
                  placeholder={field.placeholder}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    onChange(field.name, event.target.value)
                  }
                />
              )
            );
          }

          case "json": {
            const text =
              typeof value === "string"
                ? value
                : value === undefined || value === null
                  ? ""
                  : JSON.stringify(value, null, 2);

            return (
              <Box key={key} paddingTop={3}>
                <Field.Root name={key} hint={field.hint} required={field.required}>
                  <Field.Label>{field.label}</Field.Label>
                  <textarea
                    value={text}
                    rows={4}
                    style={monospace}
                    onChange={(event) => onChange(field.name, event.target.value)}
                  />
                  <Field.Hint />
                </Field.Root>
              </Box>
            );
          }

          case "textarea":
            return wrap(
              <textarea
                value={typeof value === "string" ? value : ""}
                rows={3}
                style={{ ...monospace, fontFamily: "inherit" }}
                onChange={(event) => onChange(field.name, event.target.value)}
              />
            );

          default:
            return wrap(
              <TextInput
                name={key}
                value={typeof value === "string" ? value : ""}
                placeholder={field.placeholder}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  onChange(field.name, event.target.value)
                }
              />
            );
        }
      })}

      {fields.length === 0 ? (
        <Box paddingTop={2}>
          <Typography variant="pi" textColor="neutral500">
            This operation takes no configuration.
          </Typography>
        </Box>
      ) : null}
    </>
  );
};

export { StepFields };
