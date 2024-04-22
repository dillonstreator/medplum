import express from 'express';
import { initApp, shutdownApp } from '../app';
import { loadTestConfig } from '../config';
import { initTestAuth } from '../test.setup';
import request from 'supertest';
import { ContentType, getReferenceString } from '@medplum/core';
import { Bundle, Patient, Practitioner, RelatedPerson } from '@medplum/fhirtypes';
import { randomUUID } from 'crypto';

const app = express();
let accessToken: string;

describe('Batch and Transaction processing', () => {
  beforeAll(async () => {
    const config = await loadTestConfig();
    await initApp(app, config);
    accessToken = await initTestAuth();
  });

  afterAll(async () => {
    await shutdownApp();
  });

  test('Batch success', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    const idSystem = 'http://example.com/uuid';

    const res1 = await request(app)
      .post(`/fhir/R4/Practitioner`)
      .set('Authorization', 'Bearer ' + accessToken)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({ resourceType: 'Practitioner' });
    expect(res1.status).toEqual(201);
    expect(res1.body.resourceType).toEqual('Practitioner');
    const practitioner = res1.body as Practitioner;

    const res2 = await request(app)
      .post(`/fhir/R4/Patient`)
      .set('Authorization', 'Bearer ' + accessToken)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({ resourceType: 'Patient' });
    expect(res2.status).toEqual(201);
    expect(res2.body.resourceType).toEqual('Patient');
    const toDelete = res2.body as Patient;

    const batch: Bundle = {
      resourceType: 'Bundle',
      type: 'batch',
      entry: [
        {
          request: {
            method: 'POST',
            url: 'Patient',
          },
          resource: {
            resourceType: 'Patient',
            identifier: [{ system: idSystem, value: id1 }],
          },
        },
        {
          request: {
            method: 'GET',
            url: 'Patient?identifier=http://example.com/uuid|' + randomUUID(),
          },
        },
        {
          request: {
            method: 'POST',
            url: 'Patient',
          },
          resource: {
            resourceType: 'Patient',
            identifier: [{ system: idSystem, value: id2 }],
          },
        },
        {
          request: {
            method: 'DELETE',
            url: getReferenceString(toDelete),
          },
        },
        {
          request: {
            method: 'PUT',
            url: getReferenceString(practitioner),
          },
          resource: {
            ...practitioner,
            gender: 'unknown',
          },
        },
        {
          // Will produce a 404 error in the batch response, but shouldn't fail the entire batch
          request: {
            method: 'GET',
            url: 'Practitioner/does-not-exist',
          },
        },
      ],
    };
    const res = await request(app)
      .post(`/fhir/R4/`)
      .set('Authorization', 'Bearer ' + accessToken)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send(batch);
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toEqual('Bundle');

    const results = res.body as Bundle;
    expect(results.type).toEqual('batch-response');
    expect(results.entry).toHaveLength(6);

    expect(results.entry?.[0]?.response?.status).toEqual('201');
    expect(results.entry?.[0]?.resource).toMatchObject<Partial<Patient>>({
      resourceType: 'Patient',
      identifier: [{ system: idSystem, value: id1 }],
    });

    expect(results.entry?.[1]?.response?.status).toEqual('200');
    expect(results.entry?.[1]?.resource).toMatchObject<Partial<Bundle>>({
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [],
    });

    expect(results.entry?.[2]?.response?.status).toEqual('201');
    expect(results.entry?.[2]?.resource).toMatchObject<Partial<Patient>>({
      resourceType: 'Patient',
      identifier: [{ system: idSystem, value: id2 }],
    });

    expect(results.entry?.[3]?.response?.status).toEqual('200');
    expect(results.entry?.[3]?.resource).toBeUndefined();

    expect(results.entry?.[4]?.response?.status).toEqual('200');
    expect(results.entry?.[4]?.resource).toMatchObject<Partial<Practitioner>>({
      resourceType: 'Practitioner',
      gender: 'unknown',
    });

    expect(results.entry?.[5]?.response?.status).toEqual('404');
    expect(results.entry?.[5]?.resource).toBeUndefined();
  });

  test('Transaction success', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    const idSystem = 'http://example.com/uuid';

    const res1 = await request(app)
      .post(`/fhir/R4/Practitioner`)
      .set('Authorization', 'Bearer ' + accessToken)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({ resourceType: 'Practitioner' });
    expect(res1.status).toEqual(201);
    expect(res1.body.resourceType).toEqual('Practitioner');
    const practitioner = res1.body as Practitioner;

    const res2 = await request(app)
      .post(`/fhir/R4/Patient`)
      .set('Authorization', 'Bearer ' + accessToken)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({ resourceType: 'Patient' });
    expect(res2.status).toEqual(201);
    expect(res2.body.resourceType).toEqual('Patient');
    const toDelete = res2.body as Patient;

    const res3 = await request(app)
      .post(`/fhir/R4/RelatedPerson`)
      .set('Authorization', 'Bearer ' + accessToken)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({
        resourceType: 'RelatedPerson',
        patient: { reference: getReferenceString(toDelete) },
      });
    expect(res3.status).toEqual(201);
    expect(res3.body.resourceType).toEqual('RelatedPerson');
    const relatedPerson = res3.body as RelatedPerson;

    const createdPatientIdentity = 'urn:uuid:c5db5c3b-bd41-4c39-aa8e-2d2a9a038167';
    const transaction: Bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          fullUrl: createdPatientIdentity,
          request: {
            method: 'POST',
            url: 'Patient',
          },
          resource: {
            resourceType: 'Patient',
            identifier: [{ system: idSystem, value: id1 }],
          },
        },
        {
          request: {
            method: 'GET',
            url: 'Patient?identifier=http://example.com/uuid|' + randomUUID(),
          },
        },
        {
          request: {
            method: 'POST',
            url: 'Patient',
          },
          resource: {
            resourceType: 'Patient',
            identifier: [{ system: idSystem, value: id2 }],
          },
        },
        {
          request: {
            method: 'DELETE',
            url: getReferenceString(toDelete),
          },
        },
        {
          request: {
            method: 'PUT',
            url: getReferenceString(practitioner),
          },
          resource: {
            ...practitioner,
            gender: 'unknown',
          },
        },
        {
          request: {
            method: 'GET',
            url: 'RelatedPerson',
          },
        },
        {
          request: {
            method: 'PUT',
            url: 'RelatedPerson?patient=' + getReferenceString(toDelete),
          },
          resource: { ...relatedPerson, patient: { reference: createdPatientIdentity } },
        },
      ],
    };
    const res = await request(app)
      .post(`/fhir/R4/`)
      .set('Authorization', 'Bearer ' + accessToken)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send(transaction);
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toEqual('Bundle');

    const results = res.body as Bundle;
    expect(results.entry).toHaveLength(7);
    expect(results.type).toEqual('transaction-response');

    expect(results.entry?.[0]?.response?.status).toEqual('201');
    const createdPatient = results.entry?.[0]?.resource as Patient;
    expect(createdPatient).toMatchObject<Patient>({
      resourceType: 'Patient',
      identifier: [{ system: idSystem, value: id1 }],
    });

    expect(results.entry?.[1]?.response?.status).toEqual('200');
    expect(results.entry?.[1]?.resource).toMatchObject<Partial<Bundle>>({
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [],
    });

    expect(results.entry?.[2]?.response?.status).toEqual('201');
    expect(results.entry?.[2]?.resource).toMatchObject<Patient>({
      resourceType: 'Patient',
      identifier: [{ system: idSystem, value: id2 }],
    });

    expect(results.entry?.[3]?.response?.status).toEqual('200');
    expect(results.entry?.[3]?.resource).toBeUndefined();

    expect(results.entry?.[4]?.response?.status).toEqual('200');
    expect(results.entry?.[4]?.resource).toMatchObject<Practitioner>({
      resourceType: 'Practitioner',
      gender: 'unknown',
    });

    expect(results.entry?.[5]?.response?.status).toEqual('200');
    expect(results.entry?.[5]?.resource).toMatchObject<Bundle<RelatedPerson>>({
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [
        expect.objectContaining({
          resource: expect.objectContaining({ resourceType: 'RelatedPerson' }),
        }),
      ],
    });

    expect(results.entry?.[6]?.response?.status).toEqual('200');
    expect(results.entry?.[6]?.resource).toMatchObject<Partial<RelatedPerson>>({
      resourceType: 'RelatedPerson',
      patient: { reference: getReferenceString(createdPatient) },
    });
  });

  test('Transaction rollback', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    const idSystem = 'http://example.com/uuid';

    const res1 = await request(app)
      .post(`/fhir/R4/Practitioner`)
      .set('Authorization', 'Bearer ' + accessToken)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({ resourceType: 'Practitioner' });
    expect(res1.status).toEqual(201);
    expect(res1.body.resourceType).toEqual('Practitioner');
    const practitioner = res1.body as Practitioner;

    const res2 = await request(app)
      .post(`/fhir/R4/Patient`)
      .set('Authorization', 'Bearer ' + accessToken)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({ resourceType: 'Patient' });
    expect(res2.status).toEqual(201);
    expect(res2.body.resourceType).toEqual('Patient');
    const toDelete = res2.body as Patient;

    const transaction: Bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          request: {
            method: 'POST',
            url: 'Patient',
          },
          resource: {
            resourceType: 'Patient',
            identifier: [{ system: idSystem, value: id1 }],
          },
        },
        {
          request: {
            method: 'GET',
            url: 'Patient?identifier=http://example.com/uuid|' + randomUUID(),
          },
        },
        {
          request: {
            method: 'POST',
            url: 'Patient',
          },
          resource: {
            resourceType: 'Patient',
            identifier: [{ system: idSystem, value: id2 }],
          },
        },
        {
          request: {
            method: 'DELETE',
            url: getReferenceString(toDelete),
          },
        },
        {
          request: {
            method: 'PUT',
            url: getReferenceString(practitioner),
          },
          resource: {
            ...practitioner,
            gender: 'unknown',
          },
        },
        {
          request: {
            method: 'POST',
            url: 'Practitioner',
          },
          // Invalid resource — should cause the transaction to be rolled back
          resource: { ...practitioner, gender: ['male', 'female'] as any },
        },
      ],
    };
    const res = await request(app)
      .post(`/fhir/R4/`)
      .set('Authorization', 'Bearer ' + accessToken)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send(transaction);
    expect(res.status).toBe(400);
    expect(res.body.resourceType).toEqual('OperationOutcome');

    const res3 = await request(app)
      .get(`/fhir/R4/${getReferenceString(toDelete)}`)
      .set('Authorization', 'Bearer ' + accessToken)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({ resourceType: 'Patient' });
    // Although DELETE was processed before the failed POST in the transaction,
    // rollback means the resource should still exist after the transaction fails
    expect(res3.status).toEqual(200);
    expect(res3.body).toMatchObject<Patient>({
      resourceType: 'Patient',
      id: toDelete.id,
    });
  });

  test('Concurrent competing transactions strict uniqueness guarantees', async () => {
    const id = randomUUID();
    const idSystem = 'http://example.com/uuid';

    const transaction: Bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          request: {
            method: 'POST',
            url: 'Patient',
            ifNoneExist: `identifier=${idSystem}|${id}`,
          },
          resource: {
            resourceType: 'Patient',
            identifier: [{ system: idSystem, value: id }],
          },
        },
      ],
    };

    const results = await Promise.all(
      new Array(5).fill(undefined).map(() => {
        return request(app)
          .post(`/fhir/R4/`)
          .set('Authorization', 'Bearer ' + accessToken)
          .set('Content-Type', ContentType.FHIR_JSON)
          .send(transaction);
      })
    );
    expect(results.every((result) => result.status === 200)).toBe(true);

    const patients = await request(app)
      .get(`/fhir/R4/Patient?identifier=${idSystem}|${id}`)
      .set('Authorization', 'Bearer ' + accessToken);

    expect((patients.body as Bundle).entry?.length).toBe(1);
  });

  // TODO: test locking behavior with multiple mutated resource type in a bundle

  test('Create batch wrong content type', async () => {
    const res = await request(app)
      .post(`/fhir/R4/`)
      .set('Authorization', 'Bearer ' + accessToken)
      .set('Content-Type', ContentType.TEXT)
      .send('hello');
    expect(res.status).toBe(400);
  });
});
